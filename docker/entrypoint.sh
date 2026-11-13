#!/bin/sh
set -eu

# Download the default CPU model into the persistent model volume on first start.
if [ -n "${WHISPER_MODEL_PATH:-}" ]; then
  if [ ! -f "$WHISPER_MODEL_PATH" ]; then
    echo "Whisper model not found at WHISPER_MODEL_PATH=$WHISPER_MODEL_PATH" >&2
    exit 1
  fi
else
  model="${WHISPER_MODEL:-base}"
  model_path="${WHISPER_MODELS_DIR:-/models}/ggml-${model}.bin"
  if [ ! -f "$model_path" ]; then
    mkdir -p "$(dirname "$model_path")"
    temp_path="${model_path}.part"
    model_url="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${model}.bin"
    echo "Downloading Whisper model '${model}' to ${model_path}"
    curl --fail --location --retry 3 --output "$temp_path" "$model_url"
    mv "$temp_path" "$model_path"
  fi
fi

if [ "${WHISPER_VAD:-true}" != "false" ]; then
  if [ -n "${WHISPER_VAD_MODEL_PATH:-}" ]; then
    if [ ! -f "$WHISPER_VAD_MODEL_PATH" ]; then
      echo "Whisper VAD model not found at WHISPER_VAD_MODEL_PATH=$WHISPER_VAD_MODEL_PATH" >&2
      exit 1
    fi
  else
    vad_model_path="${WHISPER_MODELS_DIR:-/models}/ggml-silero-v6.2.0.bin"
    if [ ! -f "$vad_model_path" ]; then
      mkdir -p "$(dirname "$vad_model_path")"
      temp_path="${vad_model_path}.part"
      model_url="https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v6.2.0.bin"
      echo "Downloading Whisper Silero VAD model to ${vad_model_path} (under 1 MB)"
      curl --fail --location --retry 3 --output "$temp_path" "$model_url"
      echo "2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987  $temp_path" | sha256sum --check --status || {
        rm -f "$temp_path"
        echo "Whisper VAD model checksum mismatch" >&2
        exit 1
      }
      mv "$temp_path" "$vad_model_path"
    fi
    echo "2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987  $vad_model_path" | sha256sum --check --status || {
      echo "Whisper VAD model checksum mismatch at $vad_model_path" >&2
      exit 1
    }
  fi
fi

exec "$@"
