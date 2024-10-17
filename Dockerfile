FROM --platform=$TARGETPLATFORM ubuntu:22.04 AS builder

# 安装必要的构建工具和依赖
RUN apt-get update && \
    apt-get install -y wget make gcc libreadline-dev zlib1g-dev libssl-dev libc6-dev

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
                LDFLAGS="-static -static-libgcc" \
                LIBS="-ldl -lm" \
                CFLAGS="-fPIC" && \
    make -C src/bin/psql && \
    make -C src/bin/psql install DESTDIR=/output

# 剥离调试信息以减小文件大小
RUN strip /output/usr/local/pgsql/bin/psql

# 使用空白镜像作为最终镜像
FROM scratch
COPY --from=builder /output /
