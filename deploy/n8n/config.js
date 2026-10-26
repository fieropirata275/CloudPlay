// ⚙️ Edita estos valores (o usa variables de entorno de n8n con $env si las tienes permitidas)
return [{
  json: {
    // CloudPlay
    cloudplayUrl: "https://play.example.com",
    adminEmail: "admin@example.com",
    adminPassword: "CAMBIA_ESTO",
    // Proxmox: crea un API token (Datacenter → Permissions → API Tokens) con permisos VM.Clone, VM.Allocate,
    // VM.PowerMgmt, VM.Config.* y Datastore.AllocateSpace sobre el pool/almacenamiento de las VMs
    proxmoxUrl: "https://proxmox.example.com:8006",
    proxmoxToken: "root@pam!cloudplay=00000000-0000-0000-0000-000000000000",
    proxmoxNode: "pve",
    proxmoxInsecureTls: true,           // certificado autofirmado de Proxmox
    templateId: 9100,                   // la de deploy/proxmox/cloudplay-pve.sh node-template
    vmPrefix: "cloudplay-node",
    // Reglas de escalado
    minNodes: 1,                        // nunca menos de estos nodos encendidos
    maxNodes: 6,                        // ni más de estos
    minFreeSlots: 2,                    // huecos libres que queremos tener siempre (colchón para picos)
    // Aviso opcional (Slack, Discord, Teams, Telegram via webhook...). Vacío = sin avisos
    webhookUrl: "",
  },
}];
