# Ryan dashboard Engineering and simulator access

## Access

After signing in, open Library, choose Switching Simulator, and select Start Synthetic Exercise. The default exercise opens the Island, Twin and Iroquois r013 draft. Engineering in the sidebar opens UWPC and SCADA Telemetry.

## Cause

The Library marked Training disabled. The installed Training section contained a placeholder. A capture-phase Library handler intercepted Engineering clicks, and module filtering applied demo restrictions to Ryan in the repository version. The installed dashboard also disables the Ryan demo-preview styling flag, so routing must read the resolved operator session.

## Source change

The Engineering click passes for the Ryan operator. Module access permits Ryan's Engineering modules and switching simulator. Library links to the simulator module in the v3 shell and retains the originating Library build for return navigation. Demo restrictions continue to apply.

## Installation

The installed dashboard received the protected training API, simulator package, runtime drawing, trainer scripts and navigation corrections. Source preimages and hash checks were recorded under the integration lock. The managed port 4180 backend restarted with the installed changes.

## Browser checks

An isolated browser fixture using the installed dashboard files and a synthetic Ryan operator session opened the v1 Engineering menu and UWPC Builder. The Library entry launched the v3 simulator and created a paused revision 2 exercise with 21 units. The draft and unverified warning were visible.

## Regression checks

632 Python tests and 347 subtests passed. The 21 optional PostgreSQL and browser integrations were skipped. All 74 JavaScript tests passed, including Ryan routing and demo/site-only denial regressions.

## Live verification boundary

Production sign-in returned 200 and anonymous requests to the simulator API returned 401. The previous operator session expired during the backend restart. An authenticated post-restart live exercise requires Ryan to sign in again. The as-built and native ABB acceptance status remains unverified.
