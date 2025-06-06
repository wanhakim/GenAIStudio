# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

# Use node 20.11.1 as the base image
FROM node:latest AS vite-app

COPY react /usr/app/react
WORKDIR /usr/app/react

RUN npm install --legacy-peer-deps && npm run build

FROM nginx:1.27.4-alpine-slim

# Install uuidgen in the nginx:alpine image
RUN apk add --no-cache util-linux \
    && apk upgrade --no-cache

COPY --from=vite-app /usr/app/react/dist /usr/share/nginx/html
COPY ./react/env.sh /docker-entrypoint.d/env.sh

COPY ./react/nginx.conf /etc/nginx/conf.d/default.conf
RUN chmod +x /docker-entrypoint.d/env.sh