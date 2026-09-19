import { ethers } from "hardhat";

async function main() {
  const Counter = await ethers.getContractFactory("Counter");
  const c = await Counter.deploy();
  await c.waitForDeployment();
  console.log("Counter deployed to:", await c.getAddress());
}

main().catch((e) => { console.error(e); process.exit(1); });
