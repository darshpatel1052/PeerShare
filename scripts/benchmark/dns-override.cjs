// Optional measurement-only resolution during a documented DNS transition.
// The destination must equal this deployment's configured EIP; TLS/SNI remain on.
const dns = require("node:dns");
const net = require("node:net");
const fs = require("node:fs");
const address = process.env.BENCHMARK_DNS_OVERRIDE;
if (address) {
  const state = JSON.parse(
    fs.readFileSync(".local/aws/terraform/terraform.tfstate", "utf8"),
  );
  if (!net.isIPv4(address) || address !== state.outputs.public_ip.value)
    throw Error("Benchmark DNS override must match the configured AWS EIP");
  const lookup = dns.lookup;
  dns.lookup = function (hostname, options, callback) {
    if (hostname !== "peerscreen.darshpatel.dev")
      return lookup.apply(this, arguments);
    if (typeof options === "function") {
      callback = options;
      options = {};
    }
    process.nextTick(() =>
      options?.all
        ? callback(null, [{ address, family: 4 }])
        : callback(null, address, 4),
    );
  };
}
