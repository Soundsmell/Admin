FROM node:22-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    mecab libmecab-dev \
    git build-essential automake autoconf libtool pkg-config \
  && git clone --depth 1 https://bitbucket.org/eunjeon/mecab-ko-dic.git /tmp/mecab-ko-dic \
  && cd /tmp/mecab-ko-dic \
  && ./autogen.sh \
  && ./configure \
  && make -j$(nproc) \
  && make install \
  && ldconfig \
  && cd / \
  && rm -rf /tmp/mecab-ko-dic \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

ENV NODE_ENV=production
ENV PORT=8000

EXPOSE 8000

CMD ["npm", "start"]
