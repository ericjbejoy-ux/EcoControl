# Build a small Node 20 image for the standalone mock API workspace.
FROM node:20-alpine
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN npm ci
COPY tsconfig.base.json ./tsconfig.base.json
COPY apps/api ./apps/api
COPY packages/shared ./packages/shared
EXPOSE 4000
ENV NODE_ENV=production
CMD ["npm", "run", "start", "--workspace", "apps/api"]
