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

Regarding wording of scouting:

One word that could encompass all of these activities is "fieldwork." Fieldwork refers to any work or research that is conducted outside of a traditional office or laboratory setting. It can involve activities such as data collection, observation, or testing in the field. In your case, scouting out, assembling, disassembling, and controlling ad spaces would all be considered forms of fieldwork since they require physically going out to specific locations to perform these tasks.

There are several alternatives to the term "fieldwork" that you can use to describe these activities. Here are a few options:

On-site work: This term refers to work that is performed on location, rather than in an office or other central location. It is a broad term that can encompass a wide range of activities, including the ones your scouts are performing.

Mobile work: This term refers to work that is performed on the go, typically using mobile devices or other portable technology. Since your scouts are driving out to different locations to perform their tasks, this term could be a good fit.

Out-of-office work: This term is similar to "on-site work" and refers to any work that is performed outside of a traditional office setting. It can include activities such as traveling, attending meetings or events, and conducting research.

Site visits: This term specifically refers to visits made to a specific location for the purpose of conducting some kind of assessment or inspection. It could be a good fit if your scouts are primarily going out to check ad spaces or control them.

Ultimately, the choice of terminology will depend on the specific context and the tone or style that you want to convey.
=======
# Restoring gzip backup
`mongorestore --host localhost:27017 --gzip --archive=dump.gz --db rheinkultur-wawi`
