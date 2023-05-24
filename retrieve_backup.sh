#!/bin/bash
filename=$(date +'%d-%m-%Y').gz
aws s3 cp s3://rheinkultur-wawi/db-backups/mongodump_lastest.gz ./db-backups/"$filename"
