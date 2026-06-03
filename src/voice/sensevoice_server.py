#!/usr/bin/env python3
"""
BaiLongma 本地 SenseVoice 语音服务
- 使用 FunAudioLLM/SenseVoiceSmall（FunASR）做中文优先本地 ASR
- WebSocket 协议兼容原 whisper_server.py：
  * JSON {type:'config', lang}
  * PCM int16 mono 16kHz 二进制帧
  * JSON {type:'transcript', text, is_final:true}
"""

import argparse
import asyncio
import json
import os
import re
import sys
import math
import time
from concurrent.futures import ThreadPoolExecutor

import numpy as np

try:
    import websockets
except ImportError:
    print("[语音] 缺少 websockets 包，请运行: pip install websockets", flush=True)
    sys.exit(1)

try:
    from funasr import AutoModel
    from funasr.utils.postprocess_utils import rich_transcription_postprocess
except ImportError:
    print("[语音] 缺少 FunASR/SenseVoice 依赖，请运行: pip install funasr modelscope huggingface_hub soundfile", flush=True)
    sys.exit(1)

try:
    from resemblyzer import VoiceEncoder, preprocess_wav
except Exception:
    VoiceEncoder = None
    preprocess_wav = None

SAMPLE_RATE = 16000
CHUNK_SAMPLES = SAMPLE_RATE // 4

# SenseVoice 对静音幻觉比 Whisper 少，但仍先用能量门控过滤视频/环境音。
SILENCE_RMS_THRESHOLD = 0.0035
NEAR_SPEECH_RMS_THRESHOLD = 0.0075
MIN_UTTERANCE_PEAK_RMS = 0.010
MIN_UTTERANCE_VOICED_CHUNKS = 1
MIN_UTTERANCE_SECONDS = 0.28
SILENCE_CHUNKS_TO_FLUSH = 4
MAX_BUFFER_SECONDS = 20
SPEAKER_VERIFY_THRESHOLD = 0.55
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
VOICEPRINT_PATH = os.path.join(PROJECT_ROOT, "data", "voiceprint.json")

_HALLUCINATION_FRAGMENTS = [
    "字幕", "翻译", "感谢收看", "感谢观看", "谢谢收看", "谢谢观看",
    "请订阅", "请关注", "点赞", "订阅", "转发", "打赏", "明镜", "栏目",
    "subtitles by", "thank you for watching", "please subscribe", "amara.org",
]
_HALLUCINATION_REGEXES = [
    r"(我不想说了|我只想说了|我想说了)[,，。.\s]*(.*?)(我不想说了|我只想说了|我想说了)",
    r"(嗨|嘿|喂)[,，。.\s]*(三毛|三猫)[,，。.\s]*",
]


def is_hallucination(text: str) -> bool:
    t = str(text or "").strip()
    if not t or len(t) <= 1:
        return True
    if re.match(r"^[\s\W]+$", t):
        return True
    tl = t.lower()
    if any(frag.lower() in tl for frag in _HALLUCINATION_FRAGMENTS):
        return True
    if any(re.search(pat, t, flags=re.I) for pat in _HALLUCINATION_REGEXES):
        return True
    segs = [s.strip() for s in re.split(r"[,，、。.！!？?\s]+", t) if s.strip()]
    if len(segs) >= 4 and len(set(segs)) <= 2:
        return True
    compact = re.sub(r"[\s,，、。.！!？?]+", "", t)
    for n in range(2, 9):
        for i in range(0, max(0, len(compact) - n * 3 + 1)):
            unit = compact[i:i + n]
            if len(set(unit)) > 1 and unit * 3 in compact:
                return True
    return False


def map_lang(lang: str) -> str:
    value = str(lang or "zh").lower()
    if value in ("zh", "zh-cn", "cn", "mandarin", "chinese"):
        return "zh"
    if value in ("zh-tw", "yue", "cantonese"):
        return "yue" if value == "yue" else "zh"
    if value.startswith("en"):
        return "en"
    if value.startswith("ja"):
        return "ja"
    if value.startswith("ko"):
        return "ko"
    return "auto"


class SenseVoiceServer:
    def __init__(self, host="127.0.0.1", port=3723, model_name="sensevoice-small"):
        self.host = host
        self.port = port
        self.model_name = model_name
        self.model = None
        self.speaker_encoder = None
        self.voiceprint = self._load_voiceprint()
        self._executor = ThreadPoolExecutor(max_workers=1)

    def _load_voiceprint(self):
        try:
            with open(VOICEPRINT_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
            emb = np.array(data.get("embedding") or [], dtype=np.float32)
            if emb.size > 0:
                norm = np.linalg.norm(emb)
                if norm > 0:
                    return emb / norm
        except Exception:
            pass
        return None

    def _save_voiceprint(self, emb):
        os.makedirs(os.path.dirname(VOICEPRINT_PATH), exist_ok=True)
        emb = np.array(emb, dtype=np.float32)
        norm = np.linalg.norm(emb)
        if norm > 0:
            emb = emb / norm
        with open(VOICEPRINT_PATH, "w", encoding="utf-8") as f:
            json.dump({"embedding": emb.tolist(), "model": "resemblyzer-ge2e", "threshold": SPEAKER_VERIFY_THRESHOLD}, f)
        self.voiceprint = emb

    def _get_speaker_encoder(self):
        if VoiceEncoder is None or preprocess_wav is None:
            raise RuntimeError("缺少声纹依赖，请运行: pip install resemblyzer webrtcvad-wheels")
        if self.speaker_encoder is None:
            print("[语音] 加载本地声纹模型…", flush=True)
            self.speaker_encoder = VoiceEncoder()
            print("[语音] 声纹模型加载完成", flush=True)
        return self.speaker_encoder

    def _speaker_embedding(self, audio_int16: np.ndarray):
        audio_f32 = audio_int16.astype(np.float32) / 32768.0
        wav = preprocess_wav(audio_f32, source_sr=SAMPLE_RATE)
        if len(wav) < SAMPLE_RATE * 0.8:
            raise RuntimeError("录音太短，请至少说 3-5 秒")
        emb = self._get_speaker_encoder().embed_utterance(wav)
        emb = np.array(emb, dtype=np.float32)
        norm = np.linalg.norm(emb)
        return emb / norm if norm > 0 else emb

    def _speaker_similarity(self, audio_int16: np.ndarray):
        if self.voiceprint is None:
            return None
        emb = self._speaker_embedding(audio_int16)
        return float(np.dot(emb, self.voiceprint))

    def enroll_speaker(self, audio_int16: np.ndarray):
        emb = self._speaker_embedding(audio_int16)
        self._save_voiceprint(emb)
        return {"configured": True, "samples": int(len(audio_int16)), "seconds": round(len(audio_int16) / SAMPLE_RATE, 2)}

    def verify_speaker(self, audio_int16: np.ndarray, threshold=SPEAKER_VERIFY_THRESHOLD):
        if self.voiceprint is None:
            return {"configured": False, "passed": False, "score": None, "reason": "未录入声纹"}
        score = self._speaker_similarity(audio_int16)
        return {"configured": True, "passed": score >= threshold, "score": round(score, 3), "threshold": threshold}

    def load_model(self):
        default_local_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "models", "SenseVoiceSmall"))
        model_dir = os.environ.get("BAILONGMA_SENSEVOICE_MODEL_DIR") or (
            default_local_dir if os.path.exists(os.path.join(default_local_dir, "model.pt")) else "FunAudioLLM/SenseVoiceSmall"
        )
        device = os.environ.get("BAILONGMA_ASR_DEVICE", "cpu")
        hub = os.environ.get("BAILONGMA_ASR_HUB", "hf")
        print(f"[语音] 加载 SenseVoiceSmall 模型: {model_dir} (device={device})…", flush=True)
        kwargs = {"model": model_dir, "trust_remote_code": True, "device": device, "disable_update": True}
        if not os.path.isdir(model_dir):
            kwargs["hub"] = hub
        # 对实时短句，前端/服务端已经做了简单 VAD；不再启用 FunASR VAD，减少额外模型下载和延迟。
        self.model = AutoModel(**kwargs)
        print("[语音] SenseVoiceSmall 加载完成", flush=True)

    def _run_transcribe(self, audio_int16: np.ndarray, lang: str) -> str:
        try:
            audio_f32 = audio_int16.astype(np.float32) / 32768.0
            language = map_lang(lang)
            res = self.model.generate(
                input=audio_f32,
                cache={},
                language=language,
                use_itn=True,
                batch_size=1,
            )
            text = ""
            if isinstance(res, list) and res:
                text = str(res[0].get("text", ""))
            elif isinstance(res, dict):
                text = str(res.get("text", ""))
            text = rich_transcription_postprocess(text).strip()
            # SenseVoice 可能输出 <|zh|><|NEUTRAL|> 这类富标签；二次兜底清理。
            text = re.sub(r"<\|[^|]+\|>", "", text).strip()
            if is_hallucination(text):
                print(f"[语音] 过滤低质量输出: {repr(text[:60])}", flush=True)
                return ""
            return text
        except Exception as e:
            print(f"[语音] SenseVoice 识别错误: {e}", flush=True)
            return ""

    async def transcribe_async(self, audio_int16: np.ndarray, lang: str) -> str:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(self._executor, self._run_transcribe, audio_int16, lang)

    async def handle(self, websocket):
        print("[语音] 客户端已连接", flush=True)
        buf = np.array([], dtype=np.int16)
        silence_count = 0
        voiced_chunks = 0
        utterance_peak_rms = 0.0
        lang = "zh"
        speaker_verify_enabled = False
        speaker_threshold = SPEAKER_VERIFY_THRESHOLD
        enrolling = False
        enroll_buf = np.array([], dtype=np.int16)
        chunk_count = 0
        last_stat_ts = time.time()

        try:
            async for raw in websocket:
                if isinstance(raw, str):
                    try:
                        msg = json.loads(raw)
                        if msg.get("type") == "config":
                            lang = msg.get("lang", "zh") or "zh"
                            speaker_verify_enabled = bool(msg.get("speakerVerification"))
                            try:
                                speaker_threshold = float(msg.get("speakerThreshold") or SPEAKER_VERIFY_THRESHOLD)
                            except Exception:
                                speaker_threshold = SPEAKER_VERIFY_THRESHOLD
                            await websocket.send(json.dumps({
                                "type": "config_ok",
                                "lang": lang,
                                "engine": "sensevoice",
                                "speaker": {"configured": self.voiceprint is not None, "enabled": speaker_verify_enabled},
                            }))
                        elif msg.get("type") == "speaker_status":
                            await websocket.send(json.dumps({"type": "speaker_status", "configured": self.voiceprint is not None}))
                        elif msg.get("type") == "speaker_enroll_start":
                            enrolling = True
                            enroll_buf = np.array([], dtype=np.int16)
                            await websocket.send(json.dumps({"type": "speaker_enroll_started"}))
                        elif msg.get("type") == "speaker_enroll_finish":
                            enrolling = False
                            try:
                                result = await asyncio.get_event_loop().run_in_executor(self._executor, self.enroll_speaker, enroll_buf)
                                await websocket.send(json.dumps({"type": "speaker_enroll_ok", **result}))
                            except Exception as e:
                                await websocket.send(json.dumps({"type": "error", "message": f"声纹录入失败: {e}"}))
                            enroll_buf = np.array([], dtype=np.int16)
                        elif msg.get("type") == "flush":
                            if self._should_transcribe(buf, voiced_chunks, utterance_peak_rms):
                                speaker = self.verify_speaker(buf, speaker_threshold) if speaker_verify_enabled else {"passed": True}
                                if not speaker.get("passed", True):
                                    await websocket.send(json.dumps({"type": "speaker_rejected", **speaker}))
                                else:
                                    text = await self.transcribe_async(buf, lang)
                                    if text:
                                        await websocket.send(json.dumps({"type": "transcript", "text": text, "is_final": True, "speaker": speaker}))
                            buf = np.array([], dtype=np.int16)
                            silence_count = 0
                            voiced_chunks = 0
                            utterance_peak_rms = 0.0
                    except Exception:
                        pass
                    continue

                if not isinstance(raw, (bytes, bytearray)):
                    continue

                chunk = np.frombuffer(raw, dtype=np.int16)
                if len(chunk) == 0:
                    continue
                if enrolling:
                    enroll_buf = np.append(enroll_buf, chunk)
                    continue
                rms = float(np.sqrt(np.mean(chunk.astype(np.float32) ** 2))) / 32768.0
                chunk_count += 1
                now_ts = time.time()
                if chunk_count <= 5 or now_ts - last_stat_ts >= 2.0:
                    last_stat_ts = now_ts
                    peak = float(np.max(np.abs(chunk.astype(np.int32))) / 32768.0) if len(chunk) else 0.0
                    print(f"[语音] 输入音量 rms={rms:.5f} peak={peak:.5f} buf={len(buf)/SAMPLE_RATE:.2f}s", flush=True)
                is_near_speech = rms >= NEAR_SPEECH_RMS_THRESHOLD
                is_silent = rms < SILENCE_RMS_THRESHOLD

                if not is_silent:
                    buf = np.append(buf, chunk)
                    silence_count = 0
                    if is_near_speech:
                        voiced_chunks += 1
                    else:
                        voiced_chunks = max(voiced_chunks, 1)
                    utterance_peak_rms = max(utterance_peak_rms, rms)
                elif len(buf) > 0:
                    buf = np.append(buf, chunk)
                    silence_count += 1

                buf_seconds = len(buf) / SAMPLE_RATE
                should_flush_speech = silence_count >= SILENCE_CHUNKS_TO_FLUSH and buf_seconds > 0.25
                should_flush_max = buf_seconds >= MAX_BUFFER_SECONDS
                if should_flush_speech or should_flush_max:
                    if self._should_transcribe(buf, voiced_chunks, utterance_peak_rms):
                        print(f"[语音] 开始转写 len={len(buf)/SAMPLE_RATE:.2f}s voiced={voiced_chunks} peak={utterance_peak_rms:.5f}", flush=True)
                        speaker = self.verify_speaker(buf, speaker_threshold) if speaker_verify_enabled else {"passed": True}
                        if not speaker.get("passed", True):
                            await websocket.send(json.dumps({"type": "speaker_rejected", **speaker}))
                        else:
                            text = await self.transcribe_async(buf, lang)
                            if text:
                                await websocket.send(json.dumps({"type": "transcript", "text": text, "is_final": True, "speaker": speaker}))
                    else:
                        if len(buf) > 0:
                            print(f"[语音] 跳过片段 len={len(buf)/SAMPLE_RATE:.2f}s voiced={voiced_chunks} peak={utterance_peak_rms:.5f}", flush=True)
                    buf = np.array([], dtype=np.int16)
                    silence_count = 0
                    voiced_chunks = 0
                    utterance_peak_rms = 0.0
        except websockets.exceptions.ConnectionClosed:
            pass
        except Exception as e:
            print(f"[语音] 连接异常: {e}", flush=True)
        print("[语音] 客户端已断开", flush=True)

    def _should_transcribe(self, buf, voiced_chunks, peak_rms):
        return (
            len(buf) >= int(SAMPLE_RATE * MIN_UTTERANCE_SECONDS)
            and voiced_chunks >= MIN_UTTERANCE_VOICED_CHUNKS
            and peak_rms >= MIN_UTTERANCE_PEAK_RMS
        )

    async def run(self):
        self.load_model()
        print(f"[语音] WebSocket 服务启动: ws://{self.host}:{self.port}", flush=True)
        async with websockets.serve(self.handle, self.host, self.port):
            await asyncio.Future()


def main():
    parser = argparse.ArgumentParser(description="BaiLongma SenseVoice 本地语音识别服务")
    parser.add_argument("--model", default="sensevoice-small", help="本地 ASR 模型名")
    parser.add_argument("--port", type=int, default=3723, help="WebSocket 端口")
    parser.add_argument("--host", default="127.0.0.1", help="监听地址")
    args = parser.parse_args()
    server = SenseVoiceServer(host=args.host, port=args.port, model_name=args.model)
    asyncio.run(server.run())


if __name__ == "__main__":
    main()
