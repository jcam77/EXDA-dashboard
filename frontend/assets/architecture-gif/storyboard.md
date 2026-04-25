# EXDA Architecture Flow Storyboard (v1)

Duration: 20s
Canvas: 640x360
Frame rate: 10 fps

## Phase 1 (0s-4s) Plan
Title: `EXDA workflow architecture`
Nodes:
- User
- Plan tab
- Run metadata
Flow:
- User -> Plan tab -> Run metadata
Caption:
- `Phase 1: Plan and run definition`

## Phase 2 (4s-8s) Data
Nodes:
- Raw_Data/<test>
- Clean_Data/<test>
- CFD_Data
Flow:
- Run metadata -> Raw_Data
- Raw_Data -> Clean_Data
- Clean_Data -> CFD_Data (reference lane)
Caption:
- `Phase 2: Data organization per test`

## Phase 3 (8s-12s) Compute
Nodes:
- Frontend UI
- API routes
- Analysis modules
Flow:
- Frontend UI -> API routes -> Analysis modules
Caption:
- `Phase 3: Frontend to backend analysis pipeline`

## Phase 4 (12s-16s) Output
Nodes:
- Pressure analysis
- EWT analysis
- Verification metrics
Flow:
- Analysis modules -> plots + metrics
Caption:
- `Phase 4: Results and verification outputs`

## Phase 5 (16s-20s) Decision
Nodes:
- Engineering assessment
- Repeat test?
- Report/next action
Flow:
- Verification metrics -> Engineering assessment -> Decision path
Caption:
- `Phase 5: Fast decision support`

## Visual rules
- Keep labels short
- Use one highlight color at a time
- Fade in/out between phases
- No paragraph text
