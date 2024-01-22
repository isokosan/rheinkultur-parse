ARG  NODE_VERSION
FROM node:${NODE_VERSION}

# Install system dependencies
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

# build the head of the stable 8.13 branch
ARG VIPS_BRANCH=8.14
ARG VIPS_URL=https://github.com/libvips/libvips/tarball

RUN mkdir libvips-${VIPS_BRANCH} \
        && cd libvips-${VIPS_BRANCH} \
        && wget ${VIPS_URL}/${VIPS_BRANCH} -O - | tar xfz - --strip-components 1

# "--libdir lib" makes it put the library in /usr/local/lib
# we don't need GOI
RUN cd libvips-${VIPS_BRANCH} \
        && rm -rf build \
        && meson build --libdir lib -Dintrospection=false --buildtype release \
        && cd build \
        && ninja \
        && ninja test \
        && ninja install

RUN ldconfig

# Install Ghostscript, GraphicsMagick and ImageMagick after libvips
RUN apt-get install -y ghostscript graphicsmagick imagemagick

# Update npm to the latest version
RUN npm install -g npm@latest
# Install node-gyp globally
RUN npm install -g node-gyp@latest
# Set the correct path for node-gyp
# RUN npm config set node_gyp /usr/local/lib/node_modules/node-gyp/bin/node-gyp.js

# COPY PACKAGE JSON
COPY package.json .
COPY yarn.lock .
COPY rk-lint .
RUN yarn install
RUN rm -rf package.json
RUN rm -rf yarn.lock
RUN rm -rf rk-lint

WORKDIR /app