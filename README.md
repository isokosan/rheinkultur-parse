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
mongorestore --host localhost:27017 --gzip --db rheinkultur-wawi --archive=rheinkultur-20230425.gz 

then go to development.js and uncomment sync

// contracts to check
V21-0050 => https://wawi.rheinkultur-medien.de/contracts/mMt3Jjkd0y


Test docker build:
docker buildx build --platform linux/amd64 -f Dockerfile . -t mammuthosting/rheinkultur-wawi:latest
