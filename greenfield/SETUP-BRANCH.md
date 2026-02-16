# Branch Setup Instructions

## Current State

```
~/jaskmoney/                    (on main branch)
├── main.go, app.go, etc.      (v1 app - DO NOT TOUCH)
└── greenfield/                 (this folder)
    ├── phase-0.md
    ├── phase-1-N.md
    └── SETUP-BRANCH.md         (this file)
```

---

## Setup Greenfield Branch

### Step 1: Create Branch

```bash
cd ~/jaskmoney
git checkout -b greenfield/v2-framework
```

**What this does:**
- Creates new branch `greenfield/v2-framework`
- Switches to that branch
- `greenfield/` folder already exists with docs

---

### Step 2: Initialize Go Module (in greenfield/)

```bash
cd greenfield
go mod init jaskmoney
```

**This creates:**
- `greenfield/go.mod`
- Later: `greenfield/go.sum` (after first `go get`)

---

### Step 3: Verify Structure

```bash
pwd
# Should show: /home/jask/jaskmoney/greenfield

ls -la
# Should show:
#   phase-0.md
#   phase-1-N.md
#   SETUP-BRANCH.md
#   go.mod           ← NEW
```

---

### Step 4: Ready for Agent

**Your working directory should be:**
```
/home/jask/jaskmoney/greenfield
```

**On branch:**
```
greenfield/v2-framework
```

**Agent will build v2 app here:**
```
greenfield/
├── main.go          ← Agent creates this
├── core/            ← Agent creates this
├── tabs/            ← Agent creates this
├── screens/         ← Agent creates this
├── widgets/         ← Agent creates this
└── db/              ← Agent creates this
```

**Parent directory (v1 app) is never touched:**
```
~/jaskmoney/
├── main.go          ← UNTOUCHED (v1 app)
├── app.go           ← UNTOUCHED
├── render.go        ← UNTOUCHED
└── greenfield/      ← Agent works here
```

---

## Branch Workflow

### While Building Phase 0

```bash
# Work in greenfield/
cd ~/jaskmoney/greenfield

# Make changes, build code
# ...

# Commit (from jaskmoney root, not greenfield/)
cd ~/jaskmoney
git add greenfield/
git commit -m "greenfield: add screen router"
```

### Switching Between Branches

```bash
# Work on v1 app
cd ~/jaskmoney
git checkout main
go run .  # Runs v1 app

# Work on v2 app
git checkout greenfield/v2-framework
cd greenfield
go run .  # Runs v2 app
```

---

## Important Notes

1. **Two separate apps:**
   - v1: `~/jaskmoney/*.go` (on main branch)
   - v2: `~/jaskmoney/greenfield/*.go` (on greenfield branch)

2. **Never mix:**
   - Don't import v1 code from v2
   - Don't modify v1 files while on greenfield branch
   - Keep them completely separate

3. **Agent instructions:**
   - Tell agent: "Work in `/home/jask/jaskmoney/greenfield`"
   - Tell agent: "Build Phase 0 according to `phase-0.md`"
   - Agent should never touch parent directory files

4. **Extracting from v1 (during Phase 1-N):**
   - Agent can READ `../theme.go`, `../render.go`, etc.
   - Agent can COPY code and adapt it
   - Agent should NEVER modify parent files

---

## Validation Commands

### Check current branch
```bash
cd ~/jaskmoney
git branch
# Should show: * greenfield/v2-framework
```

### Check working directory
```bash
pwd
# Should show: /home/jask/jaskmoney/greenfield
```

### Check v1 app is untouched
```bash
cd ~/jaskmoney
git status
# Should show: no changes to v1 files (only greenfield/ modified)
```

### Run v2 app
```bash
cd ~/jaskmoney/greenfield
go run .
```

---

## Ready to Start

**After running these commands:**
```bash
cd ~/jaskmoney
git checkout -b greenfield/v2-framework
cd greenfield
go mod init jaskmoney
```

**You should be ready to initiate an agent with:**
- Working directory: `/home/jask/jaskmoney/greenfield`
- Task: "Build Phase 0 according to phase-0.md"
- Agent will create: `main.go`, `core/`, `tabs/`, `screens/`, `widgets/`, `db/`
