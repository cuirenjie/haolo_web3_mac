FROM node:22-alpine AS dependencies
WORKDIR /workspace
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY services/haolo-binance-gateway/package.json services/haolo-binance-gateway/package.json
RUN corepack pnpm@11.19.0 --pm-on-fail=ignore install --filter @haolo/binance-gateway --prod --frozen-lockfile

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /workspace
COPY --from=dependencies /workspace/node_modules ./node_modules
COPY --from=dependencies /workspace/services/haolo-binance-gateway/node_modules ./services/haolo-binance-gateway/node_modules
COPY services/haolo-binance-gateway/package.json ./services/haolo-binance-gateway/package.json
COPY services/haolo-binance-gateway/src ./services/haolo-binance-gateway/src
USER node
EXPOSE 8787 8788
CMD ["node", "services/haolo-binance-gateway/src/server.mjs"]
