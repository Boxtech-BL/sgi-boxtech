FROM node:22.22-alpine
WORKDIR /app
ENV NODE_ENV=production SGI_DB=/dados/sgi.db PORT=3000
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.js ./
COPY src ./src
COPY public ./public
RUN mkdir -p /dados && chown node:node /dados
USER node
VOLUME /dados
EXPOSE 3000
CMD ["node", "--no-warnings", "server.js"]
