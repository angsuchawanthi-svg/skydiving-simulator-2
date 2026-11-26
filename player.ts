// ============================================================================
// TYPES & INTERFACES
// ============================================================================

type GamePhase = 'START' | 'FREEFALL' | 'MALFUNCTION' | 'CANOPY' | 'DEBRIEF';
type MalfunctionType = 'NONE' | 'LINE_TWISTS' | 'BAG_LOCK';

interface TrajectoryPoint {
    x: number;
    y: number;
    altitude: number;
    phase: GamePhase;
}

interface Cloud {
    x: number;
    y: number;
    scale: number;
    speed: number;
}

interface PlayerState {
    x: number;
    altitude: number;
    vx: number;
    vy: number;
    pitch: number;
    flaring: boolean;
    canopyOpen: boolean;
    reserveOpen: boolean;
    malfunction: MalfunctionType;
    malfunctionStartTime: number | null;
    epReactionTime: number | null;
    pullAltitude: number | null;
}

interface EnvironmentState {
    upperWindKts: number;
    surfaceWindKts: number;
    targetX: number;
    targetRadius: number;
}

interface KeyMap {
    [key: string]: boolean;
}

interface KPIScore {
    pullScore: boolean;
    epScore: boolean;
    accuracyScore: boolean;
    flareScore: boolean;
    distanceFromTarget: number;
    landingSpeed: number;
}

// ============================================================================
// SKYDIVING SIMULATOR CLASS
// ============================================================================

class SkydivingSimulator {
    private readonly canvas: HTMLCanvasElement;
    private readonly ctx: CanvasRenderingContext2D;
    private lastTimestamp: number = 0;

    // Game State
    private phase: GamePhase = 'START';
    private instructorDrillMode: boolean = false;
    private keys: KeyMap = {};
    private trajectory: TrajectoryPoint[] = [];
    private clouds: Cloud[] = [];

    private player: PlayerState = this.createInitialPlayerState();
    private env: EnvironmentState = {
        upperWindKts: -12,
        surfaceWindKts: 10,
        targetX: 0,
        targetRadius: 15,
    };

    // Constants
    private readonly START_ALTITUDE = 10000;
    private readonly OPTIMAL_PULL_MIN = 3500;
    private readonly OPTIMAL_PULL_MAX = 4500;
    private readonly HARD_DECK = 2500;
    private readonly FLARE_ALTITUDE = 65;
    private readonly MAX_EP_TIME = 3.0;
    private readonly PIXELS_PER_METER = 1.4;

    constructor(canvasId: string) {
        const el = document.getElementById(canvasId);
        if (!(el instanceof HTMLCanvasElement)) {
            throw new Error(`Canvas element with id "${canvasId}" not found.`);
        }
        this.canvas = el;

        const context = this.canvas.getContext('2d');
        if (!context) {
            throw new Error('Failed to initialize 2D rendering context.');
        }
        this.ctx = context;

        this.initClouds();
        this.bindEvents();
        this.resizeCanvas();
        requestAnimationFrame((ts: number) => this.loop(ts));
    }

    // --------------------------------------------------------------------------
    // INITIALIZATION & EVENT BINDING
    // --------------------------------------------------------------------------

    private createInitialPlayerState(): PlayerState {
        return {
            x: -220,
            altitude: this.START_ALTITUDE,
            vx: 0,
            vy: 175,
            pitch: 0,
            flaring: false,
            canopyOpen: false,
            reserveOpen: false,
            malfunction: 'NONE',
            malfunctionStartTime: null,
            epReactionTime: null,
            pullAltitude: null,
        };
    }

    private initClouds(): void {
        this.clouds = [];
        for (let i = 0; i < 14; i++) {
            this.clouds.push({
                x: (Math.random() - 0.5) * 1600,
                y: 1200 + Math.random() * 7500,
                scale: 0.6 + Math.random() * 0.9,
                speed: 4 + Math.random() * 6,
            });
        }
    }

    private bindEvents(): void {
        window.addEventListener('resize', () => this.resizeCanvas());

        window.addEventListener('keydown', (e: KeyboardEvent) => {
            this.keys[e.code] = true;

            if (e.code === 'Space') {
                e.preventDefault();
                if (this.phase === 'FREEFALL') {
                    this.deployParachute();
                }
            }

            if (e.code === 'KeyE') {
                if (this.phase === 'MALFUNCTION') {
                    this.executeCutaway();
                }
            }
        });

        window.addEventListener('keyup', (e: KeyboardEvent) => {
            this.keys[e.code] = false;
        });
    }

    private resizeCanvas(): void {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    // --------------------------------------------------------------------------
    // PUBLIC CONTROLS (UI HOOKS)
    // --------------------------------------------------------------------------

    public startJump(forceMalfunction: boolean = false): void {
        this.instructorDrillMode = forceMalfunction;
        this.player = this.createInitialPlayerState();
        this.trajectory = [];

        this.env.upperWindKts = Math.round(Math.random() * 24 - 12);
        this.env.surfaceWindKts = Math.round(Math.random() * 16 - 8);
        if (Math.abs(this.env.surfaceWindKts) < 3) {
            this.env.surfaceWindKts = 6;
        }

        this.player.x = -this.env.surfaceWindKts * 22;
        this.phase = 'FREEFALL';
        this.updateHUDVisibility();
    }

    public toggleInstructorDrill(): void {
        this.instructorDrillMode = !this.instructorDrillMode;
        if (this.phase === 'CANOPY' && this.instructorDrillMode && !this.player.reserveOpen) {
            this.triggerMalfunction();
        }
    }

    public deployParachute(): void {
        if (this.phase !== 'FREEFALL' || this.player.canopyOpen) return;

        this.player.pullAltitude = Math.round(this.player.altitude);

        if (this.instructorDrillMode) {
            this.triggerMalfunction();
        } else {
            this.player.canopyOpen = true;
            this.phase = 'CANOPY';
        }
    }

    public executeCutaway(): void {
        if (this.phase !== 'MALFUNCTION' || this.player.malfunctionStartTime === null) return;

        const elapsed = (performance.now() - this.player.malfunctionStartTime) / 1000;
        this.player.epReactionTime = Number(elapsed.toFixed(2));
        this.player.malfunction = 'NONE';
        this.player.canopyOpen = true;
        this.player.reserveOpen = true;
        this.phase = 'CANOPY';
    }

    // --------------------------------------------------------------------------
    // SIMULATION PHYSICS & GAME LOOP
    // --------------------------------------------------------------------------

    private triggerMalfunction(): void {
        this.player.malfunction = Math.random() > 0.5 ? 'LINE_TWISTS' : 'BAG_LOCK';
        this.player.malfunctionStartTime = performance.now();
        this.phase = 'MALFUNCTION';
    }

    private loop(timestamp: number): void {
        const dt = Math.min((timestamp - this.lastTimestamp) / 1000, 0.05);
        this.lastTimestamp = timestamp;

        this.update(dt);
        this.render();

        requestAnimationFrame((ts: number) => this.loop(ts));
    }

    private update(dt: number): void {
        if (this.phase === 'START' || this.phase === 'DEBRIEF') return;

        const moveLeft = Boolean(this.keys['KeyA'] || this.keys['ArrowLeft']);
        const moveRight = Boolean(this.keys['KeyD'] || this.keys['ArrowRight']);
        const flareInput = Boolean(this.keys['KeyF'] || this.keys['ArrowUp']);

        const activeWindKts =
            this.player.altitude > 4000 ? this.env.upperWindKts : this.env.surfaceWindKts;
        const windDriftMs = activeWindKts * 0.514;

        if (this.phase === 'FREEFALL') {
            this.player.vy = 175;
            let controlVx = 0;
            if (moveLeft) controlVx -= 28;
            if (moveRight) controlVx += 28;

            this.player.vx = controlVx + windDriftMs;
            this.player.pitch = (controlVx / 28) * 0.35;

            if (this.player.altitude <= 1000) {
                this.player.pullAltitude = 1000;
                this.player.canopyOpen = true;
                this.player.reserveOpen = true;
                this.phase = 'CANOPY';
            }
        } else if (this.phase === 'MALFUNCTION') {
            this.player.vy = this.player.malfunction === 'BAG_LOCK' ? 110 : 65;
            this.player.vx = windDriftMs * 1.2;
            this.player.pitch = Math.sin(performance.now() / 80) * 0.4;

            if (this.player.altitude <= 0) {
                this.player.altitude = 0;
                this.finishJump();
                return;
            }
        } else if (this.phase === 'CANOPY') {
            this.player.flaring = flareInput && this.player.altitude <= 120;

            let steerVx = 0;
            if (moveLeft) steerVx -= 16;
            if (moveRight) steerVx += 16;

            if (this.player.flaring) {
                this.player.vy = Math.max(4, this.player.vy - 38 * dt);
                this.player.vx = steerVx * 0.4 + windDriftMs * 0.5;
                this.player.pitch = -0.22;
            } else {
                this.player.vy = 18;
                this.player.vx = steerVx + windDriftMs;
                this.player.pitch = (steerVx / 16) * 0.25;
            }
        }

        this.player.x += this.player.vx * dt;
        this.player.altitude -= this.player.vy * dt;

        const lastPoint = this.trajectory[this.trajectory.length - 1];
        if (!lastPoint || Math.abs(lastPoint.altitude - this.player.altitude) > 120) {
            this.trajectory.push({
                x: this.player.x,
                y: 0,
                altitude: Math.max(0, this.player.altitude),
                phase: this.phase,
            });
        }

        for (const cloud of this.clouds) {
            cloud.x += (cloud.speed + windDriftMs * 0.3) * dt;
            if (cloud.x > 900) cloud.x = -900;
            if (cloud.x < -900) cloud.x = 900;
        }

        if (this.player.altitude <= 0) {
            this.player.altitude = 0;
            this.finishJump();
        }
    }

    private finishJump(): void {
        this.phase = 'DEBRIEF';
        this.updateHUDVisibility();
        this.renderDebriefCard();
    }

    // --------------------------------------------------------------------------
    // KPI EVALUATION (SUCCESS CRITERIA)
    // --------------------------------------------------------------------------

    private evaluateKPIs(): KPIScore {
        const distanceFromTarget = Math.abs(this.player.x - this.env.targetX);
        const pullAlt = this.player.pullAltitude !== null ? this.player.pullAltitude : 0;

        const pullScore =
            pullAlt >= this.OPTIMAL_PULL_MIN && pullAlt <= this.OPTIMAL_PULL_MAX;

        const epScore =
            this.player.epReactionTime === null
                ? true
                : this.player.epReactionTime <= this.MAX_EP_TIME;

        const accuracyScore = distanceFromTarget <= this.env.targetRadius;
        const flareScore = this.player.vy <= 10;

        return {
            pullScore,
            epScore,
            accuracyScore,
            flareScore,
            distanceFromTarget: Math.round(distanceFromTarget),
            landingSpeed: Math.round(this.player.vy),
        };
    }

    // --------------------------------------------------------------------------
    // RENDERING PIPELINE
    // --------------------------------------------------------------------------

    private render(): void {
        const { width, height } = this.canvas;
        const ctx = this.ctx;

        ctx.clearRect(0, 0, width, height);

        const groundScreenY = height - 95;
        const cameraAltitude = Math.max(450, this.player.altitude);
        const pixelsPerFoot = (height * 0.62) / 900;

        const worldToScreenX = (worldX: number): number =>
            width / 2 + worldX * this.PIXELS_PER_METER;

        const worldToScreenY = (altFt: number): number =>
            groundScreenY - (altFt - (cameraAltitude - 450)) * pixelsPerFoot;

        // 1. Sky Gradient
        const altRatio = Math.min(1, this.player.altitude / this.START_ALTITUDE);
        const skyGrad = ctx.createLinearGradient(0, 0, 0, height);
        skyGrad.addColorStop(0, altRatio > 0.5 ? '#0f294a' : '#2563eb');
        skyGrad.addColorStop(1, '#93c5fd');
        ctx.fillStyle = skyGrad;
        ctx.fillRect(0, 0, width, height);

        // 2. Render Clouds
        for (const c of this.clouds) {
            const cx = worldToScreenX(c.x);
            const cy = worldToScreenY(c.y);
            if (cy > -100 && cy < height + 100) {
                this.drawCloud(cx, cy, c.scale);
            }
        }

        // 3. Render Ground & Dropzone Target (Red X)
        const actualGroundY = worldToScreenY(0);
        if (actualGroundY < height + 50) {
            ctx.fillStyle = '#15803d';
            ctx.fillRect(0, actualGroundY, width, height - actualGroundY + 100);

            const targetScreenX = worldToScreenX(this.env.targetX);
            ctx.fillStyle = '#166534';
            ctx.fillRect(targetScreenX - 180, actualGroundY, 360, 22);

            ctx.beginPath();
            ctx.ellipse(targetScreenX, actualGroundY + 10, 34, 9, 0, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            ctx.lineWidth = 3;
            ctx.strokeStyle = '#dc2626';
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(targetScreenX - 16, actualGroundY + 5);
            ctx.lineTo(targetScreenX + 16, actualGroundY + 15);
            ctx.moveTo(targetScreenX + 16, actualGroundY + 5);
            ctx.lineTo(targetScreenX - 16, actualGroundY + 15);
            ctx.strokeStyle = '#dc2626';
            ctx.lineWidth = 4;
            ctx.stroke();

            this.drawWindsock(targetScreenX + 85, actualGroundY);
        }

        // 4. Predictive Glide Path Trajectory Line
        const diverX = worldToScreenX(this.player.x);
        const diverY = Math.min(actualGroundY - 18, worldToScreenY(this.player.altitude));

        if (this.phase === 'CANOPY' && this.player.altitude > 20) {
            const timeToGround = this.player.altitude / Math.max(1, this.player.vy);
            const predictedLandingX = worldToScreenX(this.player.x + this.player.vx * timeToGround);

            ctx.save();
            ctx.setLineDash([6, 6]);
            ctx.beginPath();
            ctx.moveTo(diverX, diverY);
            ctx.lineTo(predictedLandingX, actualGroundY + 8);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.restore();
        }

        // 5. Render Skydiver & Parachute Canopy
        this.drawSkydiver(diverX, diverY);

        // 6. Render Telemetry HUD Overlay
        this.drawHUD();
    }

    private drawCloud(x: number, y: number, scale: number): void {
        const ctx = this.ctx;
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(scale, scale);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
        ctx.beginPath();
        ctx.arc(0, 0, 28, 0, Math.PI * 2);
        ctx.arc(26, -6, 34, 0, Math.PI * 2);
        ctx.arc(58, 0, 26, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    private drawWindsock(x: number, groundY: number): void {
        const ctx = this.ctx;
        const dir = this.env.surfaceWindKts >= 0 ? 1 : -1;
        const flutter = Math.sin(performance.now() / 140) * 3;

        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x, groundY);
        ctx.lineTo(x, groundY - 38);
        ctx.stroke();

        ctx.fillStyle = '#f97316';
        ctx.beginPath();
        ctx.moveTo(x, groundY - 38);
        ctx.lineTo(x + dir * 28, groundY - 33 + flutter);
        ctx.lineTo(x + dir * 28, groundY - 26 + flutter);
        ctx.lineTo(x, groundY - 28);
        ctx.closePath();
        ctx.fill();
    }

    private drawSkydiver(x: number, y: number): void {
        const ctx = this.ctx;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(this.player.pitch);

        if (this.player.canopyOpen) {
            ctx.strokeStyle = '#cbd5e1';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(-36, -68);
            ctx.lineTo(0, -6);
            ctx.moveTo(36, -68);
            ctx.lineTo(0, -6);
            ctx.stroke();

            ctx.fillStyle = this.player.reserveOpen ? '#f97316' : '#0284c7';
            ctx.beginPath();
            ctx.ellipse(0, -72, 44, 14, 0, Math.PI, 0);
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.stroke();
        } else if (this.phase === 'MALFUNCTION') {
            ctx.strokeStyle = '#ef4444';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(0, -6);
            ctx.lineTo(-12, -48);
            ctx.lineTo(12, -55);
            ctx.stroke();

            ctx.fillStyle = '#dc2626';
            ctx.beginPath();
            ctx.arc(0, -58, 14, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.fillStyle = '#1e293b';
        if (this.player.canopyOpen) {
            ctx.fillRect(-5, -10, 10, 20);
            ctx.beginPath();
            ctx.arc(0, -15, 5, 0, Math.PI * 2);
            ctx.fillStyle = '#f8fafc';
            ctx.fill();
        } else {
            ctx.fillRect(-14, -4, 28, 8);
            ctx.beginPath();
            ctx.arc(16, -2, 5, 0, Math.PI * 2);
            ctx.fillStyle = '#f8fafc';
            ctx.fill();
        }

        ctx.restore();
    }

    private drawHUD(): void {
        const ctx = this.ctx;
        const { width } = this.canvas;

        ctx.fillStyle = 'rgba(15, 23, 42, 0.82)';
        ctx.fillRect(16, 16, width - 32, 54);

        ctx.fillStyle = '#f8fafc';
        ctx.font = 'bold 16px monospace';
        const altText = `ALTITUDE: ${Math.round(this.player.altitude).toLocaleString()} ft`;
        const activeWind =
            this.player.altitude > 4000 ? this.env.upperWindKts : this.env.surfaceWindKts;
        const windDir = activeWind >= 0 ? '→' : '←';
        const windText = `WIND: ${Math.abs(activeWind)} kts ${windDir}`;
        const descentText = `DESCENT: -${Math.round(this.player.vy)} ft/s`;
        const distText = `TARGET OFFSET: ${Math.round(this.player.x)} m`;

        ctx.fillText(altText, 32, 48);
        ctx.fillText(windText, 260, 48);
        ctx.fillText(descentText, 460, 48);
        ctx.fillText(distText, 680, 48);

        if (
            this.phase === 'FREEFALL' &&
            this.player.altitude <= this.OPTIMAL_PULL_MAX &&
            this.player.altitude >= this.HARD_DECK
        ) {
            this.drawAlertBanner('PULL ALTITUDE REACHED — PRESS [SPACE] TO DEPLOY', '#eab308');
        } else if (this.phase === 'MALFUNCTION' && this.player.malfunctionStartTime !== null) {
            const timer = ((performance.now() - this.player.malfunctionStartTime) / 1000).toFixed(2);
            this.drawAlertBanner(
                `MALFUNCTION (${this.player.malfunction})! PRESS [E] TO CUTAWAY — ${timer}s`,
                '#dc2626'
            );
        } else if (this.phase === 'CANOPY' && this.player.altitude <= this.FLARE_ALTITUDE) {
            this.drawAlertBanner('FLARE NOW! HOLD [F] OR [UP ARROW] FOR SOFT LANDING', '#16a34a');
        }
    }

    private drawAlertBanner(message: string, bgColor: string): void {
        const ctx = this.ctx;
        const { width } = this.canvas;
        ctx.fillStyle = bgColor;
        ctx.fillRect(width / 2 - 290, 86, 580, 42);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 16px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(message, width / 2, 112);
        ctx.textAlign = 'left';
    }

    // --------------------------------------------------------------------------
    // DOM OVERLAY MANAGEMENT
    // --------------------------------------------------------------------------

    private updateHUDVisibility(): void {
        const startModal = document.getElementById('start-modal');
        const debriefModal = document.getElementById('debrief-modal');

        if (startModal instanceof HTMLElement) {
            startModal.style.display = this.phase === 'START' ? 'flex' : 'none';
        }
        if (debriefModal instanceof HTMLElement) {
            debriefModal.style.display = this.phase === 'DEBRIEF' ? 'flex' : 'none';
        }
    }

    private renderDebriefCard(): void {
        const kpis = this.evaluateKPIs();
        const resultsEl = document.getElementById('debrief-results');
        if (!(resultsEl instanceof HTMLElement)) return;

        const badge = (pass: boolean): string =>
            pass
                ? '<span style="color:#16a34a;font-weight:bold;">PASS</span>'
                : '<span style="color:#dc2626;font-weight:bold;">NEEDS WORK</span>';

        const pullDisplay =
            this.player.pullAltitude !== null ? `${this.player.pullAltitude} ft` : 'AAD Auto';

        const epDisplay =
            this.player.epReactionTime !== null
                ? `${this.player.epReactionTime}s (Target ≤ 3.0s)`
                : 'N/A (Clean Open)';

        resultsEl.innerHTML = `
      <p><strong>Deployment Altitude:</strong> ${pullDisplay} — ${badge(kpis.pullScore)}</p>
      <p><strong>EP Cutaway Reaction:</strong> ${epDisplay} — ${badge(kpis.epScore)}</p>
      <p><strong>Landing Accuracy:</strong> ${kpis.distanceFromTarget}m from Red X (Target ≤ 15m) — ${badge(kpis.accuracyScore)}</p>
      <p><strong>Touchdown Flare Speed:</strong> ${kpis.landingSpeed} ft/s (Target ≤ 10 ft/s) — ${badge(kpis.flareScore)}</p>
    `;
    }
}

// ============================================================================
// SAFE DOM BOOTSTRAP
// ============================================================================

function bindButtonClick(id: string, handler: () => void): void {
    const btn = document.getElementById(id);
    if (btn) {
        btn.addEventListener('click', handler);
    }
}

function initSimulator(): void {
    const sim = new SkydivingSimulator('simCanvas');

    bindButtonClick('btn-start-normal', () => sim.startJump(false));
    bindButtonClick('btn-start-drill', () => sim.startJump(true));
    bindButtonClick('btn-replay', () => sim.startJump(false));
    bindButtonClick('btn-replay-drill', () => sim.startJump(true));
}

if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', initSimulator);
} else {
    initSimulator();
}