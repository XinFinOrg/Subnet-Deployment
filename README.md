# Subnet Deployment

## XDPoS Private Network Generator

Official docs: [XDPoSChain privatenet](https://docs.xdc.network/xdcchain/developers/xdposchain_privatenet/)

Quick start:

```bash
curl -O https://raw.githubusercontent.com/XinFinOrg/Subnet-Deployment/v3.1.0/container-manager/start_xdpos.sh
chmod +x start_xdpos.sh
./start_xdpos.sh
```
Go to http://localhost:5210/gen_xdpos

## Subnet Deployment Generator

Official docs: [Launch subnet](https://docs.xdc.network/subnet/install_guide/launch_subnet/)

Quick start:

```bash
curl -O https://raw.githubusercontent.com/XinFinOrg/Subnet-Deployment/v3.1.0/container-manager/start.sh
chmod +x start.sh
./start.sh
```
Go to http://localhost:5210/

## For Developers

```bash
cd container-manager/src
npm run dev
```

- XDPoS Privatechain Generator: <http://localhost:5210/gen_xdpos>
- XDC Subnet Generator: <http://localhost:5210/>
