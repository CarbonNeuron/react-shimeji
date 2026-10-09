FROM oven/bun:1-alpine AS source
RUN apk add --no-cache git git-lfs
ARG SOURCE_COMMIT
RUN test -n "$SOURCE_COMMIT" && mkdir /source && cd /source && git init && \
    git remote add origin https://github.com/CarbonNeuron/react-shimeji.git && \
    git fetch --depth 1 origin "$SOURCE_COMMIT" && \
    GIT_LFS_SKIP_SMUDGE=1 git checkout --detach FETCH_HEAD && \
    git lfs pull && mv packages /packs && cd / && rm -rf /source

FROM oven/bun:1-alpine AS generate
WORKDIR /build
COPY --from=source /packs /build/packages
COPY scripts/build-cdn.ts /build/build-cdn.ts
RUN bun /build/build-cdn.ts /build/packages /build/site

FROM nginx:1.29-alpine
COPY cdn/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=generate /build/site /usr/share/nginx/html
EXPOSE 80
