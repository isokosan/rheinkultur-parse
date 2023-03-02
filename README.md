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

# SCOUTING DATA STRUCTURE IN SEARCH (elastic)

### scout: ScoutStatus
  scoutListId: ScoutList
  managerId: Manager User
  scoutId: Scout User
  status: ?

### brief: BriefingStatus // decide later


### control: ControlStatus
### disassembly: DisassemblyStatus



# Verantwortlich / Zuständig
- Ernennung von Scout-Managern / pro Cube
- Beauftragung von Scouts / pro Cube

# QUESTIONS:
### Scoutable cubes:
Do we want to add any type of cube to a new scouting list, even though it is
- already scouted
- not marketable
- town talker
- PDG aachen
