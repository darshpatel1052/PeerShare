FROM golang:1.27.2-bookworm@sha256:5cf287a799e6b94384bad13d16b14904c531f51ba65792237e122ce42b392f61 AS build
WORKDIR /src
COPY services/api/go.mod services/api/go.sum ./
RUN go mod download
COPY services/api/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /peerscreen ./cmd/peerscreen

FROM golang:1.27.2-bookworm@sha256:5cf287a799e6b94384bad13d16b14904c531f51ba65792237e122ce42b392f61 AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app/.local/uploads /app/.local/media \
    && chown -R 10001:10001 /app/.local
WORKDIR /app
COPY --from=build --chown=10001:10001 /peerscreen /peerscreen
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["/peerscreen"]
CMD ["serve"]
