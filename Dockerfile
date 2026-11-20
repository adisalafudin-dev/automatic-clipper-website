# Build whisper.cpp for Linux CPU use; the compiler stays out of the runtime image.
FROM oven/bun:1.4.4-slim AS whisper-build
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates cmake g++ git make \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /build
RUN git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git
WORKDIR /build/whisper.cpp
RUN cmake -B build -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_EXAMPLES=ON -DGGML_NATIVE=OFF \
    && cmake --build build --config Release --target whisper-cli -j 2

# Runtime contains the app, CPU whisper-cli, FFmpeg, yt-dlp, and Deno.
FROM oven/bun:1.4.4-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg libgomp1 unzip \
    && curl --fail --location https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux --output /usr/local/bin/yt-dlp \
    && curl --fail --location https://github.com/denoland/deno/releases/latest/download/deno-x86_64-unknown-linux-gnu.zip --output /tmp/deno.zip \
    && unzip /tmp/deno.zip -d /usr/local/bin \
    && rm /tmp/deno.zip \
    && chmod +x /usr/local/bin/yt-dlp \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY src ./src
COPY web ./web
COPY glossaries ./glossaries
COPY tsconfig.json ./tsconfig.json
COPY --from=whisper-build /build/whisper.cpp/build/bin/whisper-cli /usr/local/bin/whisper-cli
COPY --from=whisper-build /build/whisper.cpp/build/bin/lib*.so* /usr/local/lib/
COPY docker/entrypoint.sh /usr/local/bin/video-clipper-entrypoint
RUN sed -i 's/\r$//' /usr/local/bin/video-clipper-entrypoint \
    && chmod +x /usr/local/bin/video-clipper-entrypoint \
    && ldconfig \
    && mkdir -p /app/data /models
ENV HOST=0.0.0.0 \
    PORT=3000 \
    YT_DLP_BIN=/usr/local/bin/yt-dlp \
    WHISPER_BIN=/usr/local/bin/whisper-cli \
    WHISPER_MODELS_DIR=/models
EXPOSE 3000
VOLUME ["/app/data", "/models"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl --fail --silent http://127.0.0.1:3000/health || exit 1
ENTRYPOINT ["/usr/local/bin/video-clipper-entrypoint"]
CMD ["bun", "run", "src/server.ts"]
