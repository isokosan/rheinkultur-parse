# Limitations:
### The frontend initializes with fetching the following Objects with a limit of 1000.
- 1. Companies
- 2. PrintPackages
- 3. HousingTypes

### Cube limits
- Contracts, bookings, and departure lists have a limit of 1000 cubes max
- Production, Montage etc also have a limit of 1000 cubes

### Other Limits
- Briefings, Controls and Disassemblies have a maximum of 1000 departure lists

# Restoring gzip backup
`mongorestore --host localhost:27017 --gzip --archive=dump.gz --db rheinkultur-wawi`
