/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/sandwich.json`.
 */
export type Sandwich = {
  "address": "CvPa7U3XSH6QHGkG2PoPokuUAQd2xJqYSTupmKYank2n",
  "metadata": {
    "name": "sandwich",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "The Sandwich table program: seats, antes, the whale draw, pecks, swats and settlement on a MagicBlock Ephemeral Rollup."
  },
  "instructions": [
    {
      "name": "abortRound",
      "discriminator": [
        15,
        165,
        47,
        198,
        108,
        207,
        150,
        208
      ],
      "accounts": [
        {
          "name": "table",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "ante",
      "discriminator": [
        166,
        19,
        18,
        9,
        41,
        248,
        44,
        242
      ],
      "accounts": [
        {
          "name": "signer",
          "signer": true
        },
        {
          "name": "table",
          "writable": true
        },
        {
          "name": "seat",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  97,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "table"
              },
              {
                "kind": "account",
                "path": "seat.wallet",
                "account": "seat"
              }
            ]
          }
        },
        {
          "name": "sessionToken",
          "optional": true
        }
      ],
      "args": []
    },
    {
      "name": "buyIn",
      "discriminator": [
        126,
        94,
        133,
        165,
        163,
        236,
        161,
        152
      ],
      "accounts": [
        {
          "name": "wallet",
          "signer": true
        },
        {
          "name": "table"
        },
        {
          "name": "seat",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  97,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "table"
              },
              {
                "kind": "account",
                "path": "wallet"
              }
            ]
          }
        },
        {
          "name": "walletToken",
          "writable": true
        },
        {
          "name": "escrowToken",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "chips",
          "type": "u64"
        }
      ]
    },
    {
      "name": "cancelDraw",
      "discriminator": [
        105,
        47,
        245,
        199,
        42,
        255,
        88,
        48
      ],
      "accounts": [
        {
          "name": "table",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "cashOut",
      "discriminator": [
        1,
        110,
        57,
        58,
        159,
        157,
        243,
        192
      ],
      "accounts": [
        {
          "name": "signer",
          "signer": true
        },
        {
          "name": "table"
        },
        {
          "name": "seat",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  97,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "table"
              },
              {
                "kind": "account",
                "path": "seat.wallet",
                "account": "seat"
              }
            ]
          }
        },
        {
          "name": "custody",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  117,
                  115,
                  116,
                  111,
                  100,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "table"
              }
            ]
          }
        },
        {
          "name": "walletToken",
          "writable": true
        },
        {
          "name": "escrowToken",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "sessionToken",
          "optional": true
        }
      ],
      "args": [
        {
          "name": "chips",
          "type": "u64"
        }
      ]
    },
    {
      "name": "createTable",
      "discriminator": [
        214,
        142,
        131,
        250,
        242,
        83,
        135,
        185
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "table",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  97,
                  98,
                  108,
                  101
                ]
              },
              {
                "kind": "arg",
                "path": "tableId"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "tableId",
          "type": "u64"
        },
        {
          "name": "anteUnits",
          "type": "u64"
        },
        {
          "name": "boxCount",
          "type": "u8"
        },
        {
          "name": "validator",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "createTestMint",
      "discriminator": [
        171,
        252,
        250,
        200,
        81,
        220,
        199,
        125
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "testMint",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  101,
                  115,
                  116,
                  95,
                  117,
                  115,
                  100,
                  99
                ]
              }
            ]
          }
        },
        {
          "name": "faucetAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  97,
                  117,
                  99,
                  101,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "delegateSeat",
      "discriminator": [
        53,
        85,
        50,
        81,
        161,
        68,
        71,
        212
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "wallet"
        },
        {
          "name": "table"
        },
        {
          "name": "bufferSeat",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "seat"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                177,
                29,
                220,
                44,
                143,
                184,
                15,
                215,
                165,
                92,
                152,
                161,
                101,
                41,
                179,
                30,
                24,
                145,
                219,
                62,
                219,
                42,
                192,
                46,
                192,
                29,
                195,
                139,
                184,
                181,
                145,
                107
              ]
            }
          }
        },
        {
          "name": "delegationRecordSeat",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "seat"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "delegationMetadataSeat",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110,
                  45,
                  109,
                  101,
                  116,
                  97,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "seat"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "seat",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  97,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "table"
              },
              {
                "kind": "account",
                "path": "wallet"
              }
            ]
          }
        },
        {
          "name": "ownerProgram",
          "address": "CvPa7U3XSH6QHGkG2PoPokuUAQd2xJqYSTupmKYank2n"
        },
        {
          "name": "delegationProgram",
          "address": "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "delegateTable",
      "discriminator": [
        161,
        66,
        67,
        113,
        58,
        219,
        238,
        170
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "bufferTable",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "table"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                177,
                29,
                220,
                44,
                143,
                184,
                15,
                215,
                165,
                92,
                152,
                161,
                101,
                41,
                179,
                30,
                24,
                145,
                219,
                62,
                219,
                42,
                192,
                46,
                192,
                29,
                195,
                139,
                184,
                181,
                145,
                107
              ]
            }
          }
        },
        {
          "name": "delegationRecordTable",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "table"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "delegationMetadataTable",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110,
                  45,
                  109,
                  101,
                  116,
                  97,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "table"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "table",
          "writable": true
        },
        {
          "name": "ownerProgram",
          "address": "CvPa7U3XSH6QHGkG2PoPokuUAQd2xJqYSTupmKYank2n"
        },
        {
          "name": "delegationProgram",
          "address": "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "faucet",
      "discriminator": [
        0,
        98,
        59,
        30,
        144,
        142,
        113,
        12
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "wallet",
          "signer": true
        },
        {
          "name": "claim",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  97,
                  117,
                  99,
                  101,
                  116,
                  95,
                  99,
                  108,
                  97,
                  105,
                  109
                ]
              },
              {
                "kind": "account",
                "path": "wallet"
              }
            ]
          }
        },
        {
          "name": "testMint",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  101,
                  115,
                  116,
                  95,
                  117,
                  115,
                  100,
                  99
                ]
              }
            ]
          }
        },
        {
          "name": "faucetAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  97,
                  117,
                  99,
                  101,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "walletToken",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "flyTo",
      "discriminator": [
        149,
        123,
        89,
        32,
        93,
        78,
        68,
        206
      ],
      "accounts": [
        {
          "name": "signer",
          "signer": true
        },
        {
          "name": "table",
          "writable": true
        },
        {
          "name": "seat",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  97,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "table"
              },
              {
                "kind": "account",
                "path": "seat.wallet",
                "account": "seat"
              }
            ]
          }
        },
        {
          "name": "sessionToken",
          "optional": true
        }
      ],
      "args": [
        {
          "name": "boxIndex",
          "type": "u8"
        }
      ]
    },
    {
      "name": "join",
      "discriminator": [
        206,
        55,
        2,
        106,
        113,
        220,
        17,
        163
      ],
      "accounts": [
        {
          "name": "signer",
          "signer": true
        },
        {
          "name": "table",
          "writable": true
        },
        {
          "name": "seat",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  97,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "table"
              },
              {
                "kind": "account",
                "path": "seat.wallet",
                "account": "seat"
              }
            ]
          }
        },
        {
          "name": "sessionToken",
          "optional": true
        }
      ],
      "args": []
    },
    {
      "name": "landSwat",
      "discriminator": [
        84,
        75,
        146,
        33,
        29,
        82,
        20,
        210
      ],
      "accounts": [
        {
          "name": "table",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "leave",
      "discriminator": [
        59,
        234,
        148,
        108,
        107,
        149,
        173,
        112
      ],
      "accounts": [
        {
          "name": "signer",
          "signer": true
        },
        {
          "name": "table",
          "writable": true
        },
        {
          "name": "seat",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  97,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "table"
              },
              {
                "kind": "account",
                "path": "seat.wallet",
                "account": "seat"
              }
            ]
          }
        },
        {
          "name": "sessionToken",
          "optional": true
        }
      ],
      "args": []
    },
    {
      "name": "onWhaleDrawn",
      "discriminator": [
        88,
        64,
        238,
        109,
        203,
        36,
        2,
        194
      ],
      "accounts": [
        {
          "name": "vrfProgramIdentity",
          "signer": true,
          "address": "8jDJvu5ttcJKoECysvYq4k5bYbaqhk1baoc1gk7aq98V"
        },
        {
          "name": "table",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "randomness",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "roundNumber",
          "type": "u64"
        }
      ]
    },
    {
      "name": "peck",
      "discriminator": [
        74,
        59,
        209,
        14,
        42,
        234,
        123,
        125
      ],
      "accounts": [
        {
          "name": "signer",
          "signer": true
        },
        {
          "name": "table",
          "writable": true
        },
        {
          "name": "seat",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  97,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "table"
              },
              {
                "kind": "account",
                "path": "seat.wallet",
                "account": "seat"
              }
            ]
          }
        },
        {
          "name": "sessionToken",
          "optional": true
        }
      ],
      "args": []
    },
    {
      "name": "processUndelegation",
      "discriminator": [
        196,
        28,
        41,
        206,
        48,
        37,
        51,
        167
      ],
      "accounts": [
        {
          "name": "baseAccount",
          "writable": true
        },
        {
          "name": "buffer",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  110,
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  101,
                  45,
                  98,
                  117,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "baseAccount"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                181,
                183,
                0,
                225,
                242,
                87,
                58,
                192,
                204,
                6,
                34,
                1,
                52,
                74,
                207,
                151,
                184,
                53,
                6,
                235,
                140,
                229,
                25,
                152,
                204,
                98,
                126,
                24,
                147,
                128,
                167,
                62
              ]
            }
          }
        },
        {
          "name": "payer",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "accountSeeds",
          "type": {
            "vec": "bytes"
          }
        }
      ]
    },
    {
      "name": "raiseHand",
      "discriminator": [
        195,
        192,
        97,
        159,
        186,
        38,
        72,
        19
      ],
      "accounts": [
        {
          "name": "signer",
          "signer": true
        },
        {
          "name": "table",
          "writable": true
        },
        {
          "name": "seat",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  97,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "table"
              },
              {
                "kind": "account",
                "path": "seat.wallet",
                "account": "seat"
              }
            ]
          }
        },
        {
          "name": "sessionToken",
          "optional": true
        }
      ],
      "args": [
        {
          "name": "boxIndex",
          "type": "u8"
        }
      ]
    },
    {
      "name": "settle",
      "discriminator": [
        175,
        42,
        185,
        87,
        144,
        131,
        102,
        212
      ],
      "accounts": [
        {
          "name": "table",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "sit",
      "discriminator": [
        45,
        56,
        130,
        121,
        149,
        249,
        90,
        216
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "wallet",
          "signer": true
        },
        {
          "name": "table"
        },
        {
          "name": "seat",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  97,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "table"
              },
              {
                "kind": "account",
                "path": "wallet"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "startRound",
      "discriminator": [
        144,
        144,
        43,
        7,
        193,
        42,
        217,
        215
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "table",
          "writable": true
        },
        {
          "name": "oracleQueue",
          "writable": true,
          "address": "5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc"
        },
        {
          "name": "programIdentity",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  100,
                  101,
                  110,
                  116,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "vrfProgram",
          "address": "Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz"
        },
        {
          "name": "slotHashes",
          "address": "SysvarS1otHashes111111111111111111111111111"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "takeOff",
      "discriminator": [
        93,
        148,
        105,
        60,
        5,
        236,
        27,
        43
      ],
      "accounts": [
        {
          "name": "signer",
          "signer": true
        },
        {
          "name": "table",
          "writable": true
        },
        {
          "name": "seat",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  97,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "table"
              },
              {
                "kind": "account",
                "path": "seat.wallet",
                "account": "seat"
              }
            ]
          }
        },
        {
          "name": "sessionToken",
          "optional": true
        }
      ],
      "args": []
    },
    {
      "name": "withdrawAnte",
      "discriminator": [
        38,
        56,
        26,
        90,
        123,
        68,
        155,
        207
      ],
      "accounts": [
        {
          "name": "signer",
          "signer": true
        },
        {
          "name": "table",
          "writable": true
        },
        {
          "name": "seat",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  97,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "table"
              },
              {
                "kind": "account",
                "path": "seat.wallet",
                "account": "seat"
              }
            ]
          }
        },
        {
          "name": "sessionToken",
          "optional": true
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "faucetClaim",
      "discriminator": [
        88,
        39,
        189,
        221,
        15,
        215,
        24,
        248
      ]
    },
    {
      "name": "seat",
      "discriminator": [
        90,
        228,
        22,
        90,
        162,
        86,
        173,
        26
      ]
    },
    {
      "name": "table",
      "discriminator": [
        34,
        100,
        138,
        97,
        236,
        129,
        230,
        112
      ]
    }
  ],
  "errors": [
    {
      "code": 7000,
      "name": "wrongPhase",
      "msg": "This action is not allowed in the current phase"
    },
    {
      "code": 7001,
      "name": "notSeated",
      "msg": "The seat has not joined the table"
    },
    {
      "code": 7002,
      "name": "alreadyAnted",
      "msg": "The seat has already anted this round"
    },
    {
      "code": 7003,
      "name": "notEnoughChips",
      "msg": "The seat holds fewer chips than needed"
    },
    {
      "code": 7004,
      "name": "tooFewPlayers",
      "msg": "At least two seats must ante"
    },
    {
      "code": 7005,
      "name": "lobbyStillOpen",
      "msg": "The lobby is still open"
    },
    {
      "code": 7006,
      "name": "notTheWhale",
      "msg": "Only the whale can do that"
    },
    {
      "code": 7007,
      "name": "whaleCannotPeck",
      "msg": "The whale cannot peck or fly"
    },
    {
      "code": 7008,
      "name": "stunned",
      "msg": "The pigeon is stunned"
    },
    {
      "code": 7009,
      "name": "peckTooSoon",
      "msg": "The pigeon pecked too recently"
    },
    {
      "code": 7010,
      "name": "notPerched",
      "msg": "The pigeon is not perched on a box"
    },
    {
      "code": 7011,
      "name": "boxFull",
      "msg": "Every perch on that box is taken"
    },
    {
      "code": 7012,
      "name": "handBusy",
      "msg": "The hand is not ready"
    },
    {
      "code": 7013,
      "name": "noSwitchesLeft",
      "msg": "No switches left this round"
    },
    {
      "code": 7014,
      "name": "switchTooSoon",
      "msg": "The sandwich moved too recently"
    },
    {
      "code": 7015,
      "name": "roundNotOver",
      "msg": "The round is not over yet"
    },
    {
      "code": 7016,
      "name": "drawNotTimedOut",
      "msg": "The draw has not timed out yet"
    },
    {
      "code": 7017,
      "name": "tableFull",
      "msg": "Every seat at the table is taken"
    },
    {
      "code": 7018,
      "name": "badBox",
      "msg": "There is no such box at this table"
    },
    {
      "code": 7019,
      "name": "mathOverflow",
      "msg": "A number overflowed"
    },
    {
      "code": 7020,
      "name": "notVrf",
      "msg": "Only the VRF program can deliver the draw"
    },
    {
      "code": 7021,
      "name": "notSeatOwner",
      "msg": "The signer is neither the seat's wallet nor a session for it"
    },
    {
      "code": 7022,
      "name": "alreadySeated",
      "msg": "The seat has already joined the table"
    },
    {
      "code": 7023,
      "name": "notInRound",
      "msg": "The seat did not ante this round"
    },
    {
      "code": 7024,
      "name": "roundOver",
      "msg": "The round is over"
    },
    {
      "code": 7025,
      "name": "alreadyThere",
      "msg": "The pigeon is already on that box"
    },
    {
      "code": 7026,
      "name": "alreadyHovering",
      "msg": "The pigeon is already in the air"
    },
    {
      "code": 7027,
      "name": "badBoxCount",
      "msg": "A table has 1 to 3 boxes"
    },
    {
      "code": 7028,
      "name": "badAnte",
      "msg": "The ante must be a positive multiple of 100 token units"
    },
    {
      "code": 7029,
      "name": "zeroChips",
      "msg": "The amount must be at least one chip"
    },
    {
      "code": 7030,
      "name": "notTableSeat",
      "msg": "The account is not a seat of this table"
    },
    {
      "code": 7031,
      "name": "duplicateSeat",
      "msg": "The same seat was passed twice"
    },
    {
      "code": 7032,
      "name": "missingSeat",
      "msg": "An anted seat is missing"
    },
    {
      "code": 7033,
      "name": "staleDraw",
      "msg": "The randomness belongs to an earlier draw"
    },
    {
      "code": 7034,
      "name": "unknownQueue",
      "msg": "The oracle queue is not the ephemeral queue"
    },
    {
      "code": 7035,
      "name": "wrongTokenAccount",
      "msg": "The token account has the wrong owner or mint"
    },
    {
      "code": 7036,
      "name": "chipsNotConserved",
      "msg": "The chips at the table do not add up"
    },
    {
      "code": 7037,
      "name": "faucetCooldown",
      "msg": "The faucet gives once per wallet per hour"
    },
    {
      "code": 7038,
      "name": "badTickLength",
      "msg": "The tick length must be positive"
    },
    {
      "code": 7039,
      "name": "stillInRound",
      "msg": "The seat is in a round that is not settled"
    },
    {
      "code": 7040,
      "name": "chipsRemaining",
      "msg": "Cash out every chip before leaving"
    },
    {
      "code": 7041,
      "name": "notTable",
      "msg": "The account is not a table of this program"
    },
    {
      "code": 7042,
      "name": "abortTooEarly",
      "msg": "Only settle can end the round until its settle window closes"
    }
  ],
  "types": [
    {
      "name": "faucetClaim",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "lastClaimUnix",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "phase",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "lobby",
            "fields": [
              {
                "name": "firstAnteTick",
                "type": "u64"
              }
            ]
          },
          {
            "name": "drawing",
            "fields": [
              {
                "name": "requestedTick",
                "type": "u64"
              }
            ]
          },
          {
            "name": "live",
            "fields": [
              {
                "name": "whaleSeat",
                "type": "u8"
              }
            ]
          }
        ]
      }
    },
    {
      "name": "roundResult",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "roundNumber",
            "type": "u64"
          },
          {
            "name": "whaleWallet",
            "type": "pubkey"
          },
          {
            "name": "sandwichBox",
            "type": "u8"
          },
          {
            "name": "whaleCrumbs",
            "type": "u64"
          },
          {
            "name": "pigeonCrumbs",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "seat",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "seatIndex",
            "type": {
              "option": "u8"
            }
          },
          {
            "name": "chips",
            "type": "u64"
          },
          {
            "name": "pigeon",
            "type": {
              "defined": {
                "name": "storedPigeon"
              }
            }
          }
        ]
      }
    },
    {
      "name": "sessionTokenV2",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "targetProgram",
            "type": "pubkey"
          },
          {
            "name": "sessionSigner",
            "type": "pubkey"
          },
          {
            "name": "feePayer",
            "type": "pubkey"
          },
          {
            "name": "validUntil",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "storedHand",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "idle",
            "fields": [
              {
                "name": "readyTick",
                "type": "u64"
              }
            ]
          },
          {
            "name": "raised",
            "fields": [
              {
                "name": "boxIndex",
                "type": "u8"
              },
              {
                "name": "landsTick",
                "type": "u64"
              }
            ]
          }
        ]
      }
    },
    {
      "name": "storedPigeon",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "state",
            "type": {
              "defined": {
                "name": "storedPigeonState"
              }
            }
          },
          {
            "name": "beakCrumbs",
            "type": "u64"
          },
          {
            "name": "nextPeckTick",
            "type": "u64"
          },
          {
            "name": "lastSwatNumber",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "storedPigeonState",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "hovering"
          },
          {
            "name": "flying",
            "fields": [
              {
                "name": "boxIndex",
                "type": "u8"
              },
              {
                "name": "landsTick",
                "type": "u64"
              }
            ]
          },
          {
            "name": "perched",
            "fields": [
              {
                "name": "boxIndex",
                "type": "u8"
              }
            ]
          },
          {
            "name": "stunned",
            "fields": [
              {
                "name": "boxIndex",
                "type": "u8"
              },
              {
                "name": "untilTick",
                "type": "u64"
              }
            ]
          }
        ]
      }
    },
    {
      "name": "storedRound",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "boxCount",
            "type": "u8"
          },
          {
            "name": "sandwichBox",
            "type": "u8"
          },
          {
            "name": "endTick",
            "type": "u64"
          },
          {
            "name": "antedCrumbs",
            "type": "u64"
          },
          {
            "name": "potCrumbs",
            "type": "u64"
          },
          {
            "name": "looseCrumbs",
            "type": {
              "array": [
                "u64",
                3
              ]
            }
          },
          {
            "name": "perchClaims",
            "type": {
              "array": [
                "u8",
                3
              ]
            }
          },
          {
            "name": "hand",
            "type": {
              "defined": {
                "name": "storedHand"
              }
            }
          },
          {
            "name": "swats",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "storedSwat"
                  }
                },
                8
              ]
            }
          },
          {
            "name": "swatCount",
            "type": "u64"
          },
          {
            "name": "switchCount",
            "type": "u8"
          },
          {
            "name": "nextSwitchTick",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "storedSwat",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "number",
            "type": "u64"
          },
          {
            "name": "boxIndex",
            "type": "u8"
          },
          {
            "name": "landsTick",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "table",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "custodyBump",
            "type": "u8"
          },
          {
            "name": "tableId",
            "type": "u64"
          },
          {
            "name": "validator",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "escrow",
            "type": "pubkey"
          },
          {
            "name": "anteUnits",
            "type": "u64"
          },
          {
            "name": "chipUnits",
            "type": "u64"
          },
          {
            "name": "boxCount",
            "type": "u8"
          },
          {
            "name": "roundNumber",
            "type": "u64"
          },
          {
            "name": "seats",
            "type": {
              "array": [
                "pubkey",
                21
              ]
            }
          },
          {
            "name": "anted",
            "type": "u32"
          },
          {
            "name": "phase",
            "type": {
              "defined": {
                "name": "phase"
              }
            }
          },
          {
            "name": "round",
            "type": {
              "defined": {
                "name": "storedRound"
              }
            }
          },
          {
            "name": "lastResult",
            "type": {
              "option": {
                "defined": {
                  "name": "roundResult"
                }
              }
            }
          }
        ]
      }
    }
  ]
};
