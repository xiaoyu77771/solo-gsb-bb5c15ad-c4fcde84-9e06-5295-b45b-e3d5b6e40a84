FROM node:20-alpine

WORKDIR /app

# 仅先拷贝依赖清单，利用层缓存
COPY package.json package-lock.json ./

# 安装生产依赖（随镜像构建完成，启动即用）
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/app/data

RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 3000

# 依赖与数据目录初始化均随启动完成
CMD ["node", "server.js"]
