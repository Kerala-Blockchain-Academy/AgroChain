var Web3 = require("web3");
var SolidityEvent = require("web3/lib/web3/event.js");

(function() {
  // Planned for future features, logging, etc.
  function Provider(provider) {
    this.provider = provider;
  }

  Provider.prototype.send = function() {
    this.provider.send.apply(this.provider, arguments);
  };

  Provider.prototype.sendAsync = function() {
    this.provider.sendAsync.apply(this.provider, arguments);
  };

  var BigNumber = (new Web3()).toBigNumber(0).constructor;

  var Utils = {
    is_object: function(val) {
      return typeof val == "object" && !Array.isArray(val);
    },
    is_big_number: function(val) {
      if (typeof val != "object") return false;

      // Instanceof won't work because we have multiple versions of Web3.
      try {
        new BigNumber(val);
        return true;
      } catch (e) {
        return false;
      }
    },
    merge: function() {
      var merged = {};
      var args = Array.prototype.slice.call(arguments);

      for (var i = 0; i < args.length; i++) {
        var object = args[i];
        var keys = Object.keys(object);
        for (var j = 0; j < keys.length; j++) {
          var key = keys[j];
          var value = object[key];
          merged[key] = value;
        }
      }

      return merged;
    },
    promisifyFunction: function(fn, C) {
      var self = this;
      return function() {
        var instance = this;

        var args = Array.prototype.slice.call(arguments);
        var tx_params = {};
        var last_arg = args[args.length - 1];

        // It's only tx_params if it's an object and not a BigNumber.
        if (Utils.is_object(last_arg) && !Utils.is_big_number(last_arg)) {
          tx_params = args.pop();
        }

        tx_params = Utils.merge(C.class_defaults, tx_params);

        return new Promise(function(accept, reject) {
          var callback = function(error, result) {
            if (error != null) {
              reject(error);
            } else {
              accept(result);
            }
          };
          args.push(tx_params, callback);
          fn.apply(instance.contract, args);
        });
      };
    },
    synchronizeFunction: function(fn, instance, C) {
      var self = this;
      return function() {
        var args = Array.prototype.slice.call(arguments);
        var tx_params = {};
        var last_arg = args[args.length - 1];

        // It's only tx_params if it's an object and not a BigNumber.
        if (Utils.is_object(last_arg) && !Utils.is_big_number(last_arg)) {
          tx_params = args.pop();
        }

        tx_params = Utils.merge(C.class_defaults, tx_params);

        return new Promise(function(accept, reject) {

          var decodeLogs = function(logs) {
            return logs.map(function(log) {
              var logABI = C.events[log.topics[0]];

              if (logABI == null) {
                return null;
              }

              var decoder = new SolidityEvent(null, logABI, instance.address);
              return decoder.decode(log);
            }).filter(function(log) {
              return log != null;
            });
          };

          var callback = function(error, tx) {
            if (error != null) {
              reject(error);
              return;
            }

            var timeout = C.synchronization_timeout || 240000;
            var start = new Date().getTime();

            var make_attempt = function() {
              C.web3.eth.getTransactionReceipt(tx, function(err, receipt) {
                if (err) return reject(err);

                if (receipt != null) {
                  // If they've opted into next gen, return more information.
                  if (C.next_gen == true) {
                    return accept({
                      tx: tx,
                      receipt: receipt,
                      logs: decodeLogs(receipt.logs)
                    });
                  } else {
                    return accept(tx);
                  }
                }

                if (timeout > 0 && new Date().getTime() - start > timeout) {
                  return reject(new Error("Transaction " + tx + " wasn't processed in " + (timeout / 1000) + " seconds!"));
                }

                setTimeout(make_attempt, 1000);
              });
            };

            make_attempt();
          };

          args.push(tx_params, callback);
          fn.apply(self, args);
        });
      };
    }
  };

  function instantiate(instance, contract) {
    instance.contract = contract;
    var constructor = instance.constructor;

    // Provision our functions.
    for (var i = 0; i < instance.abi.length; i++) {
      var item = instance.abi[i];
      if (item.type == "function") {
        if (item.constant == true) {
          instance[item.name] = Utils.promisifyFunction(contract[item.name], constructor);
        } else {
          instance[item.name] = Utils.synchronizeFunction(contract[item.name], instance, constructor);
        }

        instance[item.name].call = Utils.promisifyFunction(contract[item.name].call, constructor);
        instance[item.name].sendTransaction = Utils.promisifyFunction(contract[item.name].sendTransaction, constructor);
        instance[item.name].request = contract[item.name].request;
        instance[item.name].estimateGas = Utils.promisifyFunction(contract[item.name].estimateGas, constructor);
      }

      if (item.type == "event") {
        instance[item.name] = contract[item.name];
      }
    }

    instance.allEvents = contract.allEvents;
    instance.address = contract.address;
    instance.transactionHash = contract.transactionHash;
  };

  // Use inheritance to create a clone of this contract,
  // and copy over contract's static functions.
  function mutate(fn) {
    var temp = function Clone() { return fn.apply(this, arguments); };

    Object.keys(fn).forEach(function(key) {
      temp[key] = fn[key];
    });

    temp.prototype = Object.create(fn.prototype);
    bootstrap(temp);
    return temp;
  };

  function bootstrap(fn) {
    fn.web3 = new Web3();
    fn.class_defaults  = fn.prototype.defaults || {};

    // Set the network iniitally to make default data available and re-use code.
    // Then remove the saved network id so the network will be auto-detected on first use.
    fn.setNetwork("default");
    fn.network_id = null;
    return fn;
  };

  // Accepts a contract object created with web3.eth.contract.
  // Optionally, if called without `new`, accepts a network_id and will
  // create a new version of the contract abstraction with that network_id set.
  function Contract() {
    if (this instanceof Contract) {
      instantiate(this, arguments[0]);
    } else {
      var C = mutate(Contract);
      var network_id = arguments.length > 0 ? arguments[0] : "default";
      C.setNetwork(network_id);
      return C;
    }
  };

  Contract.currentProvider = null;

  Contract.setProvider = function(provider) {
    var wrapped = new Provider(provider);
    this.web3.setProvider(wrapped);
    this.currentProvider = provider;
  };

  Contract.new = function() {
    if (this.currentProvider == null) {
      throw new Error("StructStorage error: Please call setProvider() first before calling new().");
    }

    var args = Array.prototype.slice.call(arguments);

    if (!this.unlinked_binary) {
      throw new Error("StructStorage error: contract binary not set. Can't deploy new instance.");
    }

    var regex = /__[^_]+_+/g;
    var unlinked_libraries = this.binary.match(regex);

    if (unlinked_libraries != null) {
      unlinked_libraries = unlinked_libraries.map(function(name) {
        // Remove underscores
        return name.replace(/_/g, "");
      }).sort().filter(function(name, index, arr) {
        // Remove duplicates
        if (index + 1 >= arr.length) {
          return true;
        }

        return name != arr[index + 1];
      }).join(", ");

      throw new Error("StructStorage contains unresolved libraries. You must deploy and link the following libraries before you can deploy a new version of StructStorage: " + unlinked_libraries);
    }

    var self = this;

    return new Promise(function(accept, reject) {
      var contract_class = self.web3.eth.contract(self.abi);
      var tx_params = {};
      var last_arg = args[args.length - 1];

      // It's only tx_params if it's an object and not a BigNumber.
      if (Utils.is_object(last_arg) && !Utils.is_big_number(last_arg)) {
        tx_params = args.pop();
      }

      tx_params = Utils.merge(self.class_defaults, tx_params);

      if (tx_params.data == null) {
        tx_params.data = self.binary;
      }

      // web3 0.9.0 and above calls new twice this callback twice.
      // Why, I have no idea...
      var intermediary = function(err, web3_instance) {
        if (err != null) {
          reject(err);
          return;
        }

        if (err == null && web3_instance != null && web3_instance.address != null) {
          accept(new self(web3_instance));
        }
      };

      args.push(tx_params, intermediary);
      contract_class.new.apply(contract_class, args);
    });
  };

  Contract.at = function(address) {
    if (address == null || typeof address != "string" || address.length != 42) {
      throw new Error("Invalid address passed to StructStorage.at(): " + address);
    }

    var contract_class = this.web3.eth.contract(this.abi);
    var contract = contract_class.at(address);

    return new this(contract);
  };

  Contract.deployed = function() {
    if (!this.address) {
      throw new Error("Cannot find deployed address: StructStorage not deployed or address not set.");
    }

    return this.at(this.address);
  };

  Contract.defaults = function(class_defaults) {
    if (this.class_defaults == null) {
      this.class_defaults = {};
    }

    if (class_defaults == null) {
      class_defaults = {};
    }

    var self = this;
    Object.keys(class_defaults).forEach(function(key) {
      var value = class_defaults[key];
      self.class_defaults[key] = value;
    });

    return this.class_defaults;
  };

  Contract.extend = function() {
    var args = Array.prototype.slice.call(arguments);

    for (var i = 0; i < arguments.length; i++) {
      var object = arguments[i];
      var keys = Object.keys(object);
      for (var j = 0; j < keys.length; j++) {
        var key = keys[j];
        var value = object[key];
        this.prototype[key] = value;
      }
    }
  };

  Contract.all_networks = {
  "default": {
    "abi": [
      {
        "constant": false,
        "inputs": [
          {
            "name": "ll",
            "type": "bytes"
          },
          {
            "name": "g",
            "type": "bytes"
          },
          {
            "name": "p",
            "type": "uint256"
          },
          {
            "name": "tt",
            "type": "bytes32"
          },
          {
            "name": "e",
            "type": "bytes32"
          }
        ],
        "name": "quality",
        "outputs": [],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "name": "fm",
        "outputs": [
          {
            "name": "fid",
            "type": "bytes"
          },
          {
            "name": "fname",
            "type": "bytes32"
          },
          {
            "name": "loc",
            "type": "bytes32"
          },
          {
            "name": "crop",
            "type": "bytes32"
          },
          {
            "name": "contact",
            "type": "uint256"
          },
          {
            "name": "quantity",
            "type": "uint256"
          },
          {
            "name": "exprice",
            "type": "uint256"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "j",
            "type": "bytes"
          }
        ],
        "name": "getproduce",
        "outputs": [
          {
            "name": "",
            "type": "bytes"
          },
          {
            "name": "",
            "type": "bytes32"
          },
          {
            "name": "",
            "type": "bytes32"
          },
          {
            "name": "",
            "type": "bytes32"
          },
          {
            "name": "",
            "type": "uint256"
          },
          {
            "name": "",
            "type": "uint256"
          },
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "id",
            "type": "bytes"
          },
          {
            "name": "name",
            "type": "bytes32"
          },
          {
            "name": "loc",
            "type": "bytes32"
          },
          {
            "name": "cr",
            "type": "bytes32"
          },
          {
            "name": "con",
            "type": "uint256"
          },
          {
            "name": "q",
            "type": "uint256"
          },
          {
            "name": "pr",
            "type": "uint256"
          }
        ],
        "name": "produce",
        "outputs": [],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "name": "l",
        "outputs": [
          {
            "name": "lotno",
            "type": "bytes"
          },
          {
            "name": "grade",
            "type": "bytes"
          },
          {
            "name": "mrp",
            "type": "uint256"
          },
          {
            "name": "testdate",
            "type": "bytes32"
          },
          {
            "name": "expdate",
            "type": "bytes32"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "k",
            "type": "bytes"
          }
        ],
        "name": "getquality",
        "outputs": [
          {
            "name": "",
            "type": "bytes"
          },
          {
            "name": "",
            "type": "bytes"
          },
          {
            "name": "",
            "type": "uint256"
          },
          {
            "name": "",
            "type": "bytes32"
          },
          {
            "name": "",
            "type": "bytes32"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "tester",
        "outputs": [
          {
            "name": "",
            "type": "address"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "s",
        "outputs": [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "t",
        "outputs": [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "receiver",
            "type": "address"
          },
          {
            "name": "amount",
            "type": "uint256"
          },
          {
            "name": "sender",
            "type": "address"
          }
        ],
        "name": "sendCoin",
        "outputs": [
          {
            "name": "sufficient",
            "type": "bool"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "c",
        "outputs": [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "addr",
            "type": "address"
          }
        ],
        "name": "getBalance",
        "outputs": [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "addr",
            "type": "address"
          }
        ],
        "name": "fundaddr",
        "outputs": [],
        "payable": false,
        "type": "function"
      }
    ],
    "unlinked_binary": "0x60606040526001600055600160025534610000575b6117e8806100236000396000f300606060405236156100a95763ffffffff60e060020a60003504166304eb580c81146100ae57806307467a021461014d5780632c6d8fa7146102155780635487e06e1461031a57806354bb13611461038c5780635ef53ded146104b75780638308abd41461061357806386b714e21461063c57806392d0d1531461065b578063b81e3a501461067a578063c3da42b8146106b1578063f8b2cb4f146106d0578063fb5ade31146106fb575b610000565b346100005761014b600480803590602001908201803590602001908080601f0160208091040260200160405190810160405280939291908181526020018383808284375050604080516020601f89358b018035918201839004830284018301909452808352979998810197919650918201945092508291508401838280828437509496505084359460208101359450604001359250610716915050565b005b346100005761015d600435610bf2565b6040805160208101889052908101869052606081018590526080810184905260a0810183905260c0810182905260e0808252885460026101006001831615810260001901909216049183018290528291908201908a9080156102005780601f106101d557610100808354040283529160200191610200565b820191906000526020600020905b8154815290600101906020018083116101e357829003601f168201915b50509850505050505050505060405180910390f35b3461000057610268600480803590602001908201803590602001908080601f01602080910402602001604051908101604052809392919081815260200183838082843750949650610c3d95505050505050565b604080516020808201899052918101879052606081018690526080810185905260a0810184905260c0810183905260e08082528951908201528851909182916101008301918b019080838382156102da575b8051825260208311156102da57601f1990920191602091820191016102ba565b505050905090810190601f1680156103065780820380516001836020036101000a031916815260200191505b509850505050505050505060405180910390f35b346100005761014b600480803590602001908201803590602001908080601f01602080910402602001604051908101604052809392919081815260200183838082843750949650508435946020810135945060408101359350606081013592506080810135915060a00135610fcc565b005b346100005761039c600435611373565b60408051908101849052606081018390526080810182905260a08082528654600261010060018316150260001901909116049082018190528190602082019060c08301908990801561042f5780601f106104045761010080835404028352916020019161042f565b820191906000526020600020905b81548152906001019060200180831161041257829003601f168201915b50508381038252875460026000196101006001841615020190911604808252602090910190889080156104a35780601f10610478576101008083540402835291602001916104a3565b820191906000526020600020905b81548152906001019060200180831161048657829003601f168201915b505097505050505050505060405180910390f35b346100005761050a600480803590602001908201803590602001908080601f016020809104026020016040519081016040528093929190818152602001838380828437509496506113ab95505050505050565b60408051908101849052606081018390526080810182905260a08082528651908201528551819060208083019160c08401918a01908083838215610569575b80518252602083111561056957601f199092019160209182019101610549565b505050905090810190601f1680156105955780820380516001836020036101000a031916815260200191505b50838103825287518152875160209182019189019080838382156105d4575b8051825260208311156105d457601f1990920191602091820191016105b4565b505050905090810190601f1680156106005780820380516001836020036101000a031916815260200191505b5097505050505050505060405180910390f35b34610000576106206116fa565b60408051600160a060020a039092168252519081900360200190f35b3461000057610649611709565b60408051918252519081900360200190f35b346100005761064961170f565b60408051918252519081900360200190f35b346100005761069d600160a060020a036004358116906024359060443516611715565b604080519115158252519081900360200190f35b3461000057610649611776565b60408051918252519081900360200190f35b3461000057610649600160a060020a036004351661177c565b60408051918252519081900360200190f35b346100005761014b600160a060020a036004351661179b565b005b6040805160c081018252600060a082810182815283528351602081810186528382528085019190915283850183905260608085018490526080948501939093528451918201855289825281810189905281850188905291810186905291820184905291518751919283926008928a92909182918401908083835b602083106107af5780518252601f199092019160209182019101610790565b6001836020036101000a03801982511681845116808217855250505050505090500191505090815260200160405180910390206000820151816000019080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f1061083457805160ff1916838001178555610861565b82800160010185558215610861579182015b82811115610861578251825591602001919060010190610846565b5b506108829291505b8082111561087e576000815560010161086a565b5090565b50506020820151816001019080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f106108d657805160ff1916838001178555610903565b82800160010185558215610903579182015b828111156109035782518255916020019190600101906108e8565b5b506109249291505b8082111561087e576000815560010161086a565b5090565b5050604082015160028201556060820151600382015560809091015160049091015560098054600181018083558281838015829011610a5e57600502816005028360005260206000209182019101610a5e91905b8082111561087e57600060008201805460018160011615610100020316600290046000825580601f106109ab57506109dd565b601f0160209004906000526020600020908101906109dd91905b8082111561087e576000815560010161086a565b5090565b5b5060018201805460018160011615610100020316600290046000825580601f10610a085750610a3a565b601f016020900490600052602060002090810190610a3a91905b8082111561087e576000815560010161086a565b5090565b5b5050600060028201819055600382018190556004820155600501610978565b5090565b5b505050916000526020600020906005020160005b8390919091506000820151816000019080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f10610acb57805160ff1916838001178555610af8565b82800160010185558215610af8579182015b82811115610af8578251825591602001919060010190610add565b5b50610b199291505b8082111561087e576000815560010161086a565b5090565b50506020820151816001019080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f10610b6d57805160ff1916838001178555610b9a565b82800160010185558215610b9a579182015b82811115610b9a578251825591602001919060010190610b7f565b5b50610bbb9291505b8082111561087e576000815560010161086a565b5090565b505060408201516002808301919091556060830151600383015560809092015160049091015580546001019055505b505050505050565b600781815481101561000057906000526020600020906007020160005b5060018101546002820154600383015460048401546005850154600686015495965093949293919290919087565b60206040519081016040528060008152506000600060006000600060006006886040518082805190602001908083835b60208310610c8c5780518252601f199092019160209182019101610c6d565b51815160209384036101000a600019018019909216911617905292019485525060405193849003810184208c519094600694508d9350918291908401908083835b60208310610cec5780518252601f199092019160209182019101610ccd565b51815160209384036101000a60001901801990921691161790529201948552506040519384900381018420600101548d519094600694508e9350918291908401908083835b60208310610d505780518252601f199092019160209182019101610d31565b51815160209384036101000a60001901801990921691161790529201948552506040519384900381018420600201548e519094600694508f9350918291908401908083835b60208310610db45780518252601f199092019160209182019101610d95565b6001836020036101000a03801982511681845116808217855250505050505090500191505090815260200160405180910390206003015460068c6040518082805190602001908083835b60208310610e1d5780518252601f199092019160209182019101610dfe565b6001836020036101000a03801982511681845116808217855250505050505090500191505090815260200160405180910390206004015460068d6040518082805190602001908083835b60208310610e865780518252601f199092019160209182019101610e67565b6001836020036101000a03801982511681845116808217855250505050505090500191505090815260200160405180910390206005015460068e6040518082805190602001908083835b60208310610eef5780518252601f199092019160209182019101610ed0565b518151600019602094850361010090810a82019283169219939093169190911790925294909201968752604080519788900382018820600601548e54601f6002600183161590980290950116959095049283018290048202880182019052818752929594508b9350918401905082828015610fab5780601f10610f8057610100808354040283529160200191610fab565b820191906000526020600020905b815481529060010190602001808311610f8e57829003601f168201915b5050505050965096509650965096509650965096505b919395979092949650565b6040805161010081018252600060e0828101828152835260208084018390528385018390526060808501849052608080860185905260a080870186905260c096870195909552865193840187528d84528383018d90528387018c90529083018a9052820188905291810186905291820184905291518951919283926006928c92909182918401908083835b602083106110765780518252601f199092019160209182019101611057565b6001836020036101000a03801982511681845116808217855250505050505090500191505090815260200160405180910390206000820151816000019080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f106110fb57805160ff1916838001178555611128565b82800160010185558215611128579182015b8281111561112857825182559160200191906001019061110d565b5b506111499291505b8082111561087e576000815560010161086a565b5090565b5050602082015160018083019190915560408301516002830155606083015160038301556080830151600483015560a0830151600583015560c09092015160069091015560078054918201808255909190828183801582901161125f5760070281600702836000526020600020918201910161125f91905b8082111561087e57600060008201805460018160011615610100020316600290046000825580601f106111f45750611226565b601f01602090049060005260206000209081019061122691905b8082111561087e576000815560010161086a565b5090565b5b50506000600182018190556002820181905560038201819055600482018190556005820181905560068201556007016111c1565b5090565b5b505050916000526020600020906007020160005b8390919091506000820151816000019080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f106112cc57805160ff19168380011785556112f9565b828001600101855582156112f9579182015b828111156112f95782518255916020019190600101906112de565b5b5061131a9291505b8082111561087e576000815560010161086a565b5090565b5050602082015160018083019190915560408301516002830155606083015160038301556080830151600483015560a0830151600583015560c090920151600690910155600080549091019055505b5050505050505050565b600981815481101561000057906000526020600020906005020160005b50600281015460038201546004830154929350600184019285565b602060405190810160405280600081525060206040519081016040528060008152506000600060006008866040518082805190602001908083835b602083106114055780518252601f1990920191602091820191016113e6565b51815160209384036101000a600019018019909216911617905292019485525060405193849003810184208a519094600894508b9350918291908401908083835b602083106114655780518252601f199092019160209182019101611446565b6001836020036101000a03801982511681845116808217855250505050505090500191505090815260200160405180910390206001016008886040518082805190602001908083835b602083106114cd5780518252601f1990920191602091820191016114ae565b51815160209384036101000a60001901801990921691161790529201948552506040519384900381018420600201548c519094600894508d9350918291908401908083835b602083106115315780518252601f199092019160209182019101611512565b51815160209384036101000a60001901801990921691161790529201948552506040519384900381018420600301548d519094600894508e9350918291908401908083835b602083106115955780518252601f199092019160209182019101611576565b518151600019602094850361010090810a82019283169219939093169190911790925294909201968752604080519788900382018820600401548c54601f6002600183161590980290950116959095049283018290048202880182019052818752929594508993509184019050828280156116515780601f1061162657610100808354040283529160200191611651565b820191906000526020600020905b81548152906001019060200180831161163457829003601f168201915b5050875460408051602060026001851615610100026000190190941693909304601f8101849004840282018401909252818152959a50899450925084019050828280156116df5780601f106116b4576101008083540402835291602001916116df565b820191906000526020600020905b8154815290600101906020018083116116c257829003601f168201915b50505050509350945094509450945094505b91939590929450565b600454600160a060020a031681565b60005481565b60025481565b600160a060020a0381166000908152600360205260408120548390101561173e5750600061176f565b50600160a060020a038082166000908152600360205260408082208054869003905591851681522080548301905560015b9392505050565b60015481565b600160a060020a0381166000908152600360205260409020545b919050565b600160a060020a03811660009081526003602052604090206107d090555b505600a165627a7a723058205e63cafc26e9f3caadd63ff17942a6011a77bba84f3272a64936ba8c8e65e4270029",
    "events": {},
    "updated_at": 1510504806613,
    "links": {},
    "address": "0x123f3a686a2ab2232a5926c7fe3658f8a61a2fe8"
  }
};

  Contract.checkNetwork = function(callback) {
    var self = this;

    if (this.network_id != null) {
      return callback();
    }

    this.web3.version.network(function(err, result) {
      if (err) return callback(err);

      var network_id = result.toString();

      // If we have the main network,
      if (network_id == "1") {
        var possible_ids = ["1", "live", "default"];

        for (var i = 0; i < possible_ids.length; i++) {
          var id = possible_ids[i];
          if (Contract.all_networks[id] != null) {
            network_id = id;
            break;
          }
        }
      }

      if (self.all_networks[network_id] == null) {
        return callback(new Error(self.name + " error: Can't find artifacts for network id '" + network_id + "'"));
      }

      self.setNetwork(network_id);
      callback();
    })
  };

  Contract.setNetwork = function(network_id) {
    var network = this.all_networks[network_id] || {};

    this.abi             = this.prototype.abi             = network.abi;
    this.unlinked_binary = this.prototype.unlinked_binary = network.unlinked_binary;
    this.address         = this.prototype.address         = network.address;
    this.updated_at      = this.prototype.updated_at      = network.updated_at;
    this.links           = this.prototype.links           = network.links || {};
    this.events          = this.prototype.events          = network.events || {};

    this.network_id = network_id;
  };

  Contract.networks = function() {
    return Object.keys(this.all_networks);
  };

  Contract.link = function(name, address) {
    if (typeof name == "function") {
      var contract = name;

      if (contract.address == null) {
        throw new Error("Cannot link contract without an address.");
      }

      Contract.link(contract.contract_name, contract.address);

      // Merge events so this contract knows about library's events
      Object.keys(contract.events).forEach(function(topic) {
        Contract.events[topic] = contract.events[topic];
      });

      return;
    }

    if (typeof name == "object") {
      var obj = name;
      Object.keys(obj).forEach(function(name) {
        var a = obj[name];
        Contract.link(name, a);
      });
      return;
    }

    Contract.links[name] = address;
  };

  Contract.contract_name   = Contract.prototype.contract_name   = "StructStorage";
  Contract.generated_with  = Contract.prototype.generated_with  = "3.2.0";

  // Allow people to opt-in to breaking changes now.
  Contract.next_gen = false;

  var properties = {
    binary: function() {
      var binary = Contract.unlinked_binary;

      Object.keys(Contract.links).forEach(function(library_name) {
        var library_address = Contract.links[library_name];
        var regex = new RegExp("__" + library_name + "_*", "g");

        binary = binary.replace(regex, library_address.replace("0x", ""));
      });

      return binary;
    }
  };

  Object.keys(properties).forEach(function(key) {
    var getter = properties[key];

    var definition = {};
    definition.enumerable = true;
    definition.configurable = false;
    definition.get = getter;

    Object.defineProperty(Contract, key, definition);
    Object.defineProperty(Contract.prototype, key, definition);
  });

  bootstrap(Contract);

  if (typeof module != "undefined" && typeof module.exports != "undefined") {
    module.exports = Contract;
  } else {
    // There will only be one version of this contract in the browser,
    // and we can use that.
    window.StructStorage = Contract;
  }
})();
