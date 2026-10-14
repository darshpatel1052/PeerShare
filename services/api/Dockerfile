FROM golang:1.27.2-bookworm@sha256:5cf287a799e6b94384bad13d16b14904c531f51ba65792237e122ce42b392f61 AS build
WORKDIR /src
COPY services/api/go.mod services/api/go.sum ./
RUN go mod download
COPY services/api/ ./
RUN mkdir -p /artifacts && CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /artifacts/peerscreen ./cmd/peerscreen
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /artifacts/peerscreen-media ./cmd/media && CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /artifacts/peerscreen-worker ./cmd/worker

FROM debian:bookworm-slim@sha256:7c7b2c966bc9ee8cedfeef67e0e279108992c77681fa595db4a9d65c06ccc587 AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app/.local/uploads /app/.local/media \
    && chown -R 10001:10001 /app/.local
WORKDIR /app
COPY --from=build --chown=10001:10001 /artifacts/peerscreen /peerscreen
COPY --from=build --chown=10001:10001 /artifacts/peerscreen-media /peerscreen-media
COPY --from=build --chown=10001:10001 /artifacts/peerscreen-worker /peerscreen-worker
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["/peerscreen"]
CMD ["serve"]
