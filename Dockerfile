FROM node
MAINTAINER Brian Martin <bkmartin@gmail.com>


# From here we load our application's code in, therefore the previous docker
# "layer" thats been cached will be used if possible
WORKDIR /usr/src/app
ADD . /usr/src/app

# install your application's dependencies
RUN npm install

EXPOSE 3000

CMD ["node", "cfvendo.js"]
