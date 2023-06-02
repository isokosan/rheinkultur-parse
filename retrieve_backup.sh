#!/bin/bash

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "AWS CLI is not installed. Installing..."
    # Add installation command based on your system (e.g., apt-get, yum, brew)
    # Replace the package manager command below with the appropriate one for your system
    # For example, on Ubuntu, you can use "sudo apt-get install -y awscli"
    # On macOS with Homebrew, you can use "brew install awscli"
    sudo apt-get install -y awscli
	# Set up the AWS CLI and configure it with your credentials
	aws configure
fi


filename=$(date +'%d-%m-%Y').gz
aws s3 cp s3://rheinkultur-wawi/db-backups/mongodump_lastest.gz ./db-backups/"$filename"

# with the --drop option this line might be unnecessary
# docker compose exec mongo bash -c 'mongosh rheinklultur-wawi --eval "db.dropDatabase()"'
docker compose exec mongo bash -c 'mongorestore --host localhost:27017 --gzip --drop --nsInclude=rheinkultur-wawi.* --archive=db-backups/'"$filename"

node updates/development-reset.js
