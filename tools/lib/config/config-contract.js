'use strict';
// Schemas are validation code, not environment settings.
module.exports={
  "team": {
    "type": "object",
    "required": [
      "schemaVersion",
      "team"
    ],
    "properties": {
      "schemaVersion": {
        "type": "integer",
        "enum": [
          2
        ]
      },
      "taskStores": {
        "type": "array",
        "items": {
          "type": "object",
          "required": [
            "id"
          ],
          "properties": {
            "id": {
              "type": "string",
              "minLength": 1
            },
            "enabled": {
              "type": "boolean"
            },
            "adapter": {
              "type": "string",
              "minLength": 1
            },
            "mcpServer": {
              "type": "string",
              "minLength": 1
            },
            "baseUrl": {
              "type": "string",
              "minLength": 1
            }
          },
          "additionalProperties": true
        }
      },
      "codeStores": {
        "type": "array",
        "items": {
          "type": "object",
          "required": [
            "id"
          ],
          "properties": {
            "id": {
              "type": "string",
              "minLength": 1
            },
            "enabled": {
              "type": "boolean"
            },
            "adapter": {
              "type": "string",
              "minLength": 1
            },
            "mcpServer": {
              "type": "string",
              "minLength": 1
            },
            "baseUrl": {
              "type": "string",
              "minLength": 1
            }
          },
          "additionalProperties": true
        }
      },
      "defaults": {
        "type": "object",
        "properties": {
          "taskStore": {
            "type": "string",
            "minLength": 1
          },
          "codeStore": {
            "type": "string",
            "minLength": 1
          },
          "project": {
            "type": "string",
            "minLength": 1
          },
          "repository": {
            "type": "string",
            "minLength": 1
          }
        },
        "additionalProperties": false
      },
      "team": {
        "type": "object",
        "required": [
          "id",
          "name",
          "owners"
        ],
        "properties": {
          "id": {
            "type": "string",
            "minLength": 1
          },
          "name": {
            "type": "string",
            "minLength": 1
          },
          "owners": {
            "type": "array",
            "items": {
              "type": "string",
              "minLength": 1
            }
          }
        },
        "additionalProperties": false
      }
    },
    "additionalProperties": false
  },
  "my": {
    "type": "object",
    "required": [
      "schemaVersion",
      "teamId",
      "profile",
      "storage"
    ],
    "properties": {
      "schemaVersion": {
        "type": "integer",
        "enum": [
          2
        ]
      },
      "taskStores": {
        "type": "array",
        "items": {
          "type": "object",
          "required": [
            "id"
          ],
          "properties": {
            "id": {
              "type": "string",
              "minLength": 1
            },
            "enabled": {
              "type": "boolean"
            },
            "adapter": {
              "type": "string",
              "minLength": 1
            },
            "mcpServer": {
              "type": "string",
              "minLength": 1
            },
            "baseUrl": {
              "type": "string",
              "minLength": 1
            }
          },
          "additionalProperties": true
        }
      },
      "codeStores": {
        "type": "array",
        "items": {
          "type": "object",
          "required": [
            "id"
          ],
          "properties": {
            "id": {
              "type": "string",
              "minLength": 1
            },
            "enabled": {
              "type": "boolean"
            },
            "adapter": {
              "type": "string",
              "minLength": 1
            },
            "mcpServer": {
              "type": "string",
              "minLength": 1
            },
            "baseUrl": {
              "type": "string",
              "minLength": 1
            }
          },
          "additionalProperties": true
        }
      },
      "defaults": {
        "type": "object",
        "properties": {
          "taskStore": {
            "type": "string",
            "minLength": 1
          },
          "codeStore": {
            "type": "string",
            "minLength": 1
          },
          "project": {
            "type": "string",
            "minLength": 1
          },
          "repository": {
            "type": "string",
            "minLength": 1
          }
        },
        "additionalProperties": false
      },
      "teamId": {
        "anyOf": [
          {
            "type": "string",
            "minLength": 1
          },
          {
            "type": "null"
          }
        ]
      },
      "preferences": {
        "type": "object",
        "additionalProperties": true
      },
      "profile": {
        "type": "object",
        "required": [
          "name",
          "email"
        ],
        "properties": {
          "name": {
            "type": "string",
            "minLength": 1
          },
          "email": {
            "type": "string",
            "minLength": 1
          }
        },
        "additionalProperties": false
      },
      "storage": {
        "type": "object",
        "required": [
          "mode"
        ],
        "properties": {
          "mode": {
            "type": "string",
            "enum": [
              "local",
              "repository"
            ]
          },
          "repositoryUrl": {
            "type": "string",
            "minLength": 1
          }
        },
        "additionalProperties": false
      }
    },
    "additionalProperties": false
  },
  "master": {
    "type": "object",
    "required": [
      "schemaVersion",
      "defaults",
      "execution"
    ],
    "properties": {
      "schemaVersion": {
        "type": "integer",
        "enum": [
          2
        ]
      },
      "defaults": {
        "type": "object",
        "additionalProperties": false
      },
      "execution": {
        "type": "object",
        "required": [
          "maxProcessDepth"
        ],
        "properties": {
          "maxProcessDepth": {
            "type": "integer",
            "minimum": 1
          }
        },
        "additionalProperties": false
      }
    },
    "additionalProperties": false
  }
};
