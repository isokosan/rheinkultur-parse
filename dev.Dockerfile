ARG  NODE_VERSION
FROM node:${NODE_VERSION}
RUN apt-get update -y && \
    apt-get upgrade -y && \
    apt-get install -y ghostscript graphicsmagick imagemagick
RUN yarn install
WORKDIR /app