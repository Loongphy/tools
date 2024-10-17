FROM --platform=$TARGETPLATFORM alpine:3.14 AS builder

# 安装必要的构建工具和依赖
RUN apk add --no-cache \
    build-base \
    readline-dev \
    zlib-dev \
    openssl-dev \
    linux-headers \
    wget

WORKDIR /build

# 下载并解压 PostgreSQL 源码
RUN wget https://ftp.postgresql.org/pub/source/v12.6/postgresql-12.6.tar.gz && \
    tar -xzf postgresql-12.6.tar.gz

WORKDIR /build/postgresql-12.6

# 配置和编译 psql，使用完全静态链接
RUN ./configure --prefix=/usr/local/pgsql \
                --enable-static \
                --disable-shared \
                --without-readline \
                --without-zlib \
                --without-ssl \
                --without-server \
                --without-perl \
                --without-python \
                --host=x86_64-alpine-linux-musl \
                LDFLAGS="-static" \
                LIBS="-ldl -lm" \
                CFLAGS="-fPIC -static" && \
    make -C src/bin/psql && \
    make -C src/bin/psql install DESTDIR=/output

# 剥离调试信息以减小文件大小
RUN strip /output/usr/local/pgsql/bin/psql

# 使用空白镜像作为最终镜像
FROM scratch
COPY --from=builder /output /