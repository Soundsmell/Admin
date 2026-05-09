FROM node:22-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends mecab libmecab-dev mecab-ko-dic \
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
