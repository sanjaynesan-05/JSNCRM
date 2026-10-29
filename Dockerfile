FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/tsconfig.node.json ./tsconfig.node.json
COPY --from=build /app/tsconfig.app.json ./tsconfig.app.json
RUN mkdir -p /app/data && chown -R node:node /app
ENV HOST=0.0.0.0
ENV DATABASE_PATH=/app/data/business.sqlite
VOLUME ["/app/data"]
EXPOSE 5000
USER node
CMD ["npm", "run", "start"]
