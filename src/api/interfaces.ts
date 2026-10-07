import { Router, Request, Response } from 'express';
import { mikroTikService } from '../services/mikrotik';
import { authMiddleware } from '../middleware/auth';

const router = Router();
router.use(authMiddleware);

// --- Interfaces (base) ---
router.get('/router/:routerId/interfaces', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }
    const interfaces = await mikroTikService.getInterfaces(routerId);
    res.json(interfaces);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/router/:routerId/interface/:id', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }
    const result = await mikroTikService.updateInterface(routerId, req.params.id, req.body);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// --- Interface List ---
router.get('/router/:routerId/interface-lists', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }
    const lists = await mikroTikService.getInterfaceList(routerId);
    res.json(lists);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/router/:routerId/interface-list', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }
    const result = await mikroTikService.createInterfaceList(routerId, req.body);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/router/:routerId/interface-list/:id', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }
    const result = await mikroTikService.updateInterfaceList(routerId, req.params.id, req.body);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/router/:routerId/interface-list/:id', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }
    const result = await mikroTikService.deleteInterfaceList(routerId, req.params.id);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// --- Ethernet ---
router.get('/router/:routerId/ethernet', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }
    const ethernets = await mikroTikService.getEthernet(routerId);
    res.json(ethernets);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/router/:routerId/ethernet/:id', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }
    const result = await mikroTikService.updateEthernet(routerId, req.params.id, req.body);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// --- VLAN ---
router.get('/router/:routerId/vlans', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }
    const vlans = await mikroTikService.getVlans(routerId);
    res.json(vlans);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/router/:routerId/vlan', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }
    const result = await mikroTikService.createVlan(routerId, req.body);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/router/:routerId/vlan/:id', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }
    const result = await mikroTikService.updateVlan(routerId, req.params.id, req.body);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/router/:routerId/vlan/:id', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }
    const result = await mikroTikService.deleteVlan(routerId, req.params.id);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// --- Bridge ---
router.get('/router/:routerId/bridges', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }
    const bridges = await mikroTikService.getBridges(routerId);
    res.json(bridges);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/router/:routerId/bridge', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }
    const result = await mikroTikService.createBridge(routerId, req.body);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/router/:routerId/bridge/:id', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }
    const result = await mikroTikService.updateBridge(routerId, req.params.id, req.body);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/router/:routerId/bridge/:id', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }
    const result = await mikroTikService.deleteBridge(routerId, req.params.id);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// --- EoIP ---
router.get('/router/:routerId/eoip', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }
    const eoips = await mikroTikService.getEoIP(routerId);
    res.json(eoips);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/router/:routerId/eoip', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }
    const result = await mikroTikService.createEoIP(routerId, req.body);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/router/:routerId/eoip/:id', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }
    const result = await mikroTikService.updateEoIP(routerId, req.params.id, req.body);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/router/:routerId/eoip/:id', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }
    const result = await mikroTikService.deleteEoIP(routerId, req.params.id);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// --- IP Tunnel (IPIP) ---
router.get('/router/:routerId/ip-tunnels', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }
    const tunnels = await mikroTikService.getIpTunnels(routerId);
    res.json(tunnels);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/router/:routerId/ip-tunnel', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }
    const result = await mikroTikService.createIpTunnel(routerId, req.body);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/router/:routerId/ip-tunnel/:id', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }
    const result = await mikroTikService.updateIpTunnel(routerId, req.params.id, req.body);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/router/:routerId/ip-tunnel/:id', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }
    const result = await mikroTikService.deleteIpTunnel(routerId, req.params.id);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// --- GRE ---
router.get('/router/:routerId/gre', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }
    const gres = await mikroTikService.getGRE(routerId);
    res.json(gres);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/router/:routerId/gre', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }
    const result = await mikroTikService.createGRE(routerId, req.body);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/router/:routerId/gre/:id', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }
    const result = await mikroTikService.updateGRE(routerId, req.params.id, req.body);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/router/:routerId/gre/:id', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }
    const result = await mikroTikService.deleteGRE(routerId, req.params.id);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// --- VRRP ---
router.get('/router/:routerId/vrrp', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }
    const vrrps = await mikroTikService.getVRRP(routerId);
    res.json(vrrps);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/router/:routerId/vrrp', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }
    const result = await mikroTikService.createVRRP(routerId, req.body);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/router/:routerId/vrrp/:id', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }
    const result = await mikroTikService.updateVRRP(routerId, req.params.id, req.body);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/router/:routerId/vrrp/:id', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }
    const result = await mikroTikService.deleteVRRP(routerId, req.params.id);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// --- Bonding ---
router.get('/router/:routerId/bonding', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }
    const bondings = await mikroTikService.getBonding(routerId);
    res.json(bondings);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/router/:routerId/bonding', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }
    const result = await mikroTikService.createBonding(routerId, req.body);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/router/:routerId/bonding/:id', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }
    const result = await mikroTikService.updateBonding(routerId, req.params.id, req.body);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/router/:routerId/bonding/:id', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }
    const result = await mikroTikService.deleteBonding(routerId, req.params.id);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// --- MACsec ---
router.get('/router/:routerId/macsec', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }
    const macsecs = await mikroTikService.getMACsec(routerId);
    res.json(macsecs);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/router/:routerId/macsec', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }
    const result = await mikroTikService.createMACsec(routerId, req.body);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/router/:routerId/macsec/:id', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }
    const result = await mikroTikService.updateMACsec(routerId, req.params.id, req.body);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/router/:routerId/macsec/:id', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }
    const result = await mikroTikService.deleteMACsec(routerId, req.params.id);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
