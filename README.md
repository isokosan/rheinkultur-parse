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
mongorestore --host localhost:27017 --gzip --archive=rheinkultur-20230424.gz --db rheinkultur-wawi


// contracts to check
V21-0050 => https://wawi.rheinkultur-medien.de/contracts/mMt3Jjkd0y
