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

exec "$@"
