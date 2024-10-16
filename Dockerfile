FROM --platform=$TARGETPLATFORM ubuntu:22.04
RUN apt-get update && \
    apt-get install -y wget make gcc libreadline-dev zlib1g-dev libssl-dev
RUN wget https://ftp.postgresql.org/pub/source/v12.6/postgresql-12.6.tar.gz && \
    tar -xzf postgresql-12.6.tar.gz && \
    cd postgresql-12.6 && \
    ./configure --prefix=/usr/local/pgsql --enable-static --disable-shared \
                --without-server --without-perl --without-python && \
    make -C src/bin/psql && \
    make -C src/bin/psql install
RUN strip /usr/local/pgsql/bin/psql
