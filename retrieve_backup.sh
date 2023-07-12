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

# Set the desired folder name
foldername="db-backups"
# Create the folder with the current user
mkdir -p "$foldername"
# Set the owner and group of the folder
sudo chown "$USER:$USER" "$foldername"

filename=$(date +'%d-%m-%Y').gz
# aws s3 cp s3://rheinkultur-wawi/db-backups/mongodump_lastest.gz ./"$foldername"/"$filename"

# if the script is unable to locate the file in docker, make sure the folder exists before bringing docker compose up
# with the --drop option this line might be unnecessary
docker compose exec mongo bash -c 'mongosh rheinkultur-wawi --eval "db.dropDatabase()"'
docker compose exec mongo bash -c 'mongorestore --host localhost:27017 --gzip --drop --nsInclude=rheinkultur-wawi.* --archive=./'"$foldername"/"$filename"

node updates/development-reset.js
