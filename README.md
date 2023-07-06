# Limitations:
### The frontend initializes with fetching the following Objects with a limit of 1000.
- 1. Companies
- 2. PrintPackages
- 3. HousingTypes

### Cube limits
- Contracts, bookings, and departure lists have a limit of 1000 cubes max
- Production, Montage etc also have a limit of 1000 cubes

=======
# Restoring gzip backup and syncing for development


mongo rheinkultur-wawi --eval "db.dropDatabase()"
mongorestore --host localhost:27017 --gzip --db rheinkultur-wawi --archive=db-backups/mongodump_latest.gz 

then go to development.js and uncomment sync

// scout app example:
TLK-33324A10 TLK-33324A70


// contracts to check
V21-0050 => https://wawi.rheinkultur-medien.de/contracts/mMt3Jjkd0y

Test docker build:
docker buildx build --platform linux/amd64 -f Dockerfile . -t mammuthosting/rheinkultur-wawi:latest

Example with photos with same id
96221A600
96221R600
96221V1021
dummy

## DEVELOPMENT
`docker compose up -d`
- this will create the db-backups folder with root permissions
`./retrieve_backup.sh`
- this will give the ownership of the db-backups to your user so aws cli can write to it
`docker compose logs parse -f --no-log-prefix`
- connect to parse containers logs
