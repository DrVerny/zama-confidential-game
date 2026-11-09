import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const deployed = await deploy("SealedFortune", {
    from: deployer,
    args: [],
    log: true,
  });

  console.log(`SealedFortune deployed at ${deployed.address}`);
  console.log("Paste this address into frontend/config.js as CONTRACT_ADDRESS");
};

export default func;
func.tags = ["SealedFortune"];
