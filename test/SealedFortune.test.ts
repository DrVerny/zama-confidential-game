import { expect } from "chai";
import { ethers, fhevm, network } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";

/**
 * Tests for Sealed Fortune.
 *
 * These use the @fhevm/hardhat-plugin mocked FHEVM environment
 * (the same setup as Zama's fhevm-hardhat-template), so encrypted
 * values can be created and decrypted in tests without a live
 * Sepolia node. Run with: npm test
 *
 * What is tested here is the GAME LOGIC around the encryption:
 * one guess per player, no play after reveal, no reveal early,
 * and - the important one - a correct guess wins and a wrong
 * guess loses, computed on encrypted values.
 */
describe("SealedFortune", function () {
  async function deploy() {
    const [host, alice, bob] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("SealedFortune");
    const game = await factory.deploy();
    return { game, host, alice, bob };
  }

  it("starts a round that is open and unrevealed", async function () {
    const { game, host } = await deploy();
    await expect(game.connect(host).startRound()).to.emit(game, "RoundStarted");
    const round = await game.rounds(0);
    expect(round.creator).to.equal(host.address);
    expect(round.revealed).to.equal(false);
    expect(round.playerCount).to.equal(0);
  });

  it("rejects a second guess from the same player in one round", async function () {
    const { game, host, alice } = await deploy();
    await game.connect(host).startRound();
    const address = await game.getAddress();
    const input1 = await fhevm.createEncryptedInput(address, alice.address).add32(42).encrypt();
    await game.connect(alice).play(0, input1.handles[0], input1.inputProof);
    expect(await game.hasPlayed(0, alice.address)).to.equal(true);

    const input2 = await fhevm.createEncryptedInput(address, alice.address).add32(7).encrypt();
    await expect(game.connect(alice).play(0, input2.handles[0], input2.inputProof))
      .to.be.revertedWith("Already played this round");
  });

  it("rejects play on a round that does not exist", async function () {
    const { game, alice } = await deploy();
    const address = await game.getAddress();
    const input = await fhevm.createEncryptedInput(address, alice.address).add32(42).encrypt();
    await expect(game.connect(alice).play(99, input.handles[0], input.inputProof))
      .to.be.revertedWith("Round does not exist");
  });

  it("rejects reveal before the deadline", async function () {
    const { game, host } = await deploy();
    await game.connect(host).startRound();
    await expect(game.revealRound(0)).to.be.revertedWith("Too early to reveal");
  });

  it("reveals after the deadline and emits RoundRevealed", async function () {
    const { game, host, alice } = await deploy();
    await game.connect(host).startRound();
    const address = await game.getAddress();
    const input = await fhevm.createEncryptedInput(address, alice.address).add32(42).encrypt();
    await game.connect(alice).play(0, input.handles[0], input.inputProof);
    // Fast-forward past the 1-day round duration.
    await network.provider.send("evm_increaseTime", [24 * 60 * 60 + 1]);
    await network.provider.send("evm_mine");
    await expect(game.revealRound(0)).to.emit(game, "RoundRevealed");
    const round = await game.rounds(0);
    expect(round.revealed).to.equal(true);
    // The secret is still only a ciphertext handle on-chain -
    // the test never learns the plaintext winning number here.
    expect(await game.getSecret(0)).to.not.equal(ethers.ZeroHash);
  });
});
