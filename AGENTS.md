


## Important Notes

1. **Two separate apps:**
   - v1: `~/jaskmoney/*.go` (on main branch)
   - v2: `~/jaskmoney-v2 (on v2 branch)
   	- v1 code is in `/jaskmoney-v2/legacy`

2. **Never mix:**
   - Don't import v1 code from v2
   - Don't modify legacy v1 files while on v2 branch
   - Keep them completely separate

4. **Extracting from v1 (during Phase 1-N):**
   - Agent can READ `../theme.go`, `../render.go`, etc.
   - Agent can COPY code and adapt it
   - Agent should NEVER modify parent files