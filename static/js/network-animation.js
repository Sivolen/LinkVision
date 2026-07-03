// Network Animation Canvas — общий для всех страниц
class NetworkAnimation {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.nodes = [];
        this.mouseX = 0;
        this.mouseY = 0;
        this.dpr = window.devicePixelRatio || 1;
        this.init();
    }

    init() {
        this.resize();
        this.createNodes();
        this.addEventListeners();
        this.animate();
    }

    resize() {
        const width = window.innerWidth;
        const height = window.innerHeight;
        // Устанавливаем размеры канваса в физических пикселях
        this.canvas.width = width * this.dpr;
        this.canvas.height = height * this.dpr;
        // Масштабируем контекст для рисования в логических пикселях
        this.ctx.scale(this.dpr, this.dpr);
        // НЕ ТРОГАЕМ canvas.style.width/height — они заданы через CSS
    }

    createNodes() {
        const width = window.innerWidth;
        const height = window.innerHeight;
        const nodeCount = Math.floor((width * height) / 25000);
        this.nodes = [];

        for (let i = 0; i < nodeCount; i++) {
            this.nodes.push({
                x: Math.random() * width,
                y: Math.random() * height,
                vx: (Math.random() - 0.5) * 0.5,
                vy: (Math.random() - 0.5) * 0.5,
                radius: Math.random() * 3 + 2,
                pulse: Math.random() * Math.PI * 2
            });
        }
    }

    addEventListeners() {
        window.addEventListener('resize', () => this.resize());
        this.canvas.addEventListener('mousemove', (e) => {
            this.mouseX = e.clientX;
            this.mouseY = e.clientY;
        });
    }

    updateNodes() {
        const width = window.innerWidth;
        const height = window.innerHeight;

        this.nodes.forEach(node => {
            node.x += node.vx;
            node.y += node.vy;
            node.pulse += 0.05;

            if (node.x < 0 || node.x > width) node.vx *= -1;
            if (node.y < 0 || node.y > height) node.vy *= -1;

            const dx = this.mouseX - node.x;
            const dy = this.mouseY - node.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 150) {
                const force = (150 - dist) / 150;
                node.vx -= (dx / dist) * force * 0.02;
                node.vy -= (dy / dist) * force * 0.02;
            }

            node.vx *= 0.99;
            node.vy *= 0.99;
        });
    }

    getAccentColor() {
        const style = getComputedStyle(document.documentElement);
        const color = style.getPropertyValue('--accent-color').trim();
        const hex = color.replace('#', '');
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        return { r, g, b };
    }

    drawNodes() {
        const { r, g, b } = this.getAccentColor();

        this.nodes.forEach(node => {
            const pulse = Math.sin(node.pulse) * 0.3 + 1;

            this.ctx.beginPath();
            this.ctx.arc(node.x, node.y, node.radius * pulse, 0, Math.PI * 2);
            this.ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.6 + pulse * 0.2})`;
            this.ctx.fill();

            this.ctx.beginPath();
            this.ctx.arc(node.x, node.y, node.radius * pulse * 2, 0, Math.PI * 2);
            const gradient = this.ctx.createRadialGradient(
                node.x, node.y, 0,
                node.x, node.y, node.radius * pulse * 2
            );
            gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.3)`);
            gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
            this.ctx.fillStyle = gradient;
            this.ctx.fill();
        });
    }

    drawConnections() {
        const { r, g, b } = this.getAccentColor();
        const maxDist = 180;

        for (let i = 0; i < this.nodes.length; i++) {
            for (let j = i + 1; j < this.nodes.length; j++) {
                const dx = this.nodes[i].x - this.nodes[j].x;
                const dy = this.nodes[i].y - this.nodes[j].y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < maxDist) {
                    const opacity = (1 - dist / maxDist) * 0.4;
                    this.ctx.beginPath();
                    this.ctx.moveTo(this.nodes[i].x, this.nodes[i].y);
                    this.ctx.lineTo(this.nodes[j].x, this.nodes[j].y);
                    this.ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${opacity})`;
                    this.ctx.lineWidth = 1;
                    this.ctx.stroke();
                }
            }
        }
    }

    animate() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.updateNodes();
        this.drawNodes();
        this.drawConnections();
        requestAnimationFrame(() => this.animate());
    }
}

// Инициализация на странице
document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('networkCanvas');
    if (canvas) {
        new NetworkAnimation(canvas);
    }
});