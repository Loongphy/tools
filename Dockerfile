FROM --platform=$TARGETPLATFORM ubuntu:22.04 AS builder

RUN apt-get update && \
    apt-get install -y wget make gcc libreadline-dev zlib1g-dev libssl-dev

WORKDIR /build

RUN wget https://ftp.postgresql.org/pub/source/v12.6/postgresql-12.6.tar.gz && \
    tar -xzf postgresql-12.6.tar.gz

WORKDIR /build/postgresql-12.6

RUN ./configure --prefix=/usr/local/pgsql \
                --enable-static \
                --disable-shared \
                --without-server \
                --without-perl \
                --without-python \
                LDFLAGS="-static" \
                CFLAGS="-fPIC" && \
    make -C src/bin/psql && \
    make -C src/bin/psql install DESTDIR=/output

RUN strip /output/usr/local/pgsql/bin/psql

FROM scratch
COPY --from=builder /output /
