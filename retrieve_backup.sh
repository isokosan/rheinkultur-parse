#!/bin/bash
filename=$(date +'%d-%m-%Y').gz
aws s3 cp s3://rheinkultur-wawi/db-backups/mongodump_lastest.gz ./db-backups/"$filename"

mongo rheinkultur-wawi --eval "db.dropDatabase()"
mongorestore --host localhost:27017 --gzip --db rheinkultur-wawi --archive=db-backups/"$filename"

node updates/development-reset.js
