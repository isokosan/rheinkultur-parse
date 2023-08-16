ARG  NODE_VERSION
FROM node:${NODE_VERSION} AS base
RUN apt-get update -y && \
    apt-get upgrade -y && \
    apt-get install -y \
        build-essential \
        pkg-config \
        software-properties-common \
        ninja-build \
        meson \
        bc \
        wget \
        glib-2.0-dev \
        libglib2.0-dev \
        libjpeg-dev \
        libexpat1-dev \
        librsvg2-dev \
        libpng-dev \
        libgsf-1-dev \
        libtiff5-dev \
        libexif-dev \
        liblcms2-dev \
        libheif-examples \
        libheif-dev \
        liborc-dev

WORKDIR /usr/local/src
ARG VIPS_BRANCH=8.14
ARG VIPS_URL=https://github.com/libvips/libvips/tarball
RUN mkdir libvips-${VIPS_BRANCH} \
    && cd libvips-${VIPS_BRANCH} \
    && wget ${VIPS_URL}/${VIPS_BRANCH} -O - | tar xfz - --strip-components 1
RUN cd libvips-${VIPS_BRANCH} \
    && rm -rf build \
    && meson build --libdir lib -Dintrospection=false --buildtype release \
    && cd build \
    && ninja \
    && ninja test \
    && ninja install

RUN ldconfig

RUN apt-get install -y ghostscript graphicsmagick imagemagick

RUN mkdir -p /usr/src/app/node_modules && chown -R node:node /usr/src/app
WORKDIR /usr/src/app
COPY package.json ./
COPY yarn.lock ./
COPY CHANGELOG.md ./

# copy local npm package
COPY rk-lint ./rk-lint

FROM base AS dependencies
USER node
RUN yarn install --frozen-lockfile --production --non-interactive --no-progress --prefer-offline --network-timeout 100000

FROM base AS release
COPY --from=dependencies --chown=node:node /usr/src/app/node_modules ./node_modules
COPY --chown=node:node src ./src

ENV PORT=1337

EXPOSE $PORT

CMD [ "yarn", "start" ]
