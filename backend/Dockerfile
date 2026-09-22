FROM rust:1.89-bookworm AS builder

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends pkg-config libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY migrations ./migrations

RUN cargo build --release

FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libpq5 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/target/release/k-todo-server /usr/local/bin/k-todo-server

ENV BIND_ADDR=0.0.0.0:8080
ENV DATABASE_URL=postgres://postgres:postgres@postgres:5432/k_todo
ENV RUST_LOG=info

EXPOSE 8080

CMD ["k-todo-server"]
