FROM alpine:3.14
RUN apk add --no-cache lighttpd
COPY lighttpd.conf /etc/lighttpd/lighttpd.conf
COPY . /var/www/localhost/htdocs
EXPOSE 80
CMD ["lighttpd", "-D", "-f", "/etc/lighttpd/lighttpd.conf"]