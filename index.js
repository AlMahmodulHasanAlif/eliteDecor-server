const express = require("express");
require("dotenv").config();
const cors = require("cors");
const app = express();
const port = process.env.PORT || 3000;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

//middleware
app.use(cors());
app.use(express.json());
//verifyadmin
const verifyAdmin = async (req, res, next) => {
  const email = req.user.email;
  const user = await usersCollection.findOne({ email });
  
  if (user?.role !== 'admin') {
    return res.status(403).send({ message: 'Forbidden: Admin access required' });
  }
  
  next();
};  

const uri = `mongodb+srv://${process.env.MONGO_USER}:${process.env.MONGO_PASS}@cluster0.ill4a2j.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
async function run() {
  try {
    const database = client.db("eliteDecorDB");
    const servicesCollection = database.collection("services");
    const usersCollection = database.collection("users");
    const bookingsCollection = database.collection("booking");

    app.get("/users/:email", async (req, res) => {
      const email = req.params.email;
      const user = await usersCollection.findOne({ email });
      res.send(user);
    });

    //get user data
    app.post("/users", async (req, res) => {
      const user = req.body;

      const existingUser = await usersCollection.findOne({
        email: user.email,
      });

      if (existingUser) {
        return res.send({ message: "User already exists" });
      }

      const result = await usersCollection.insertOne({
        ...user,
        role: "user",
        createdAt: new Date(),
      });

      res.send(result);
    });

    // Get all services with optional limit
    app.get("/services", async (req, res) => {
      const { limit, search, category, sort } = req.query;
      const query = {};
      if (search) {
        query.service_name = { $regex: search, $options: "i" };
      }
      if (category) {
        query.service_category = category;
      }

      let sortOption = { createdAt: -1 };
      if (sort === "price_asc") sortOption = { cost: 1 };
      else if (sort === "price_desc") sortOption = { cost: -1 };

      let cursor = servicesCollection.find(query).sort(sortOption);

      if (limit) {
        cursor = cursor.limit(parseInt(limit));
      }

      const services = await cursor.toArray();
      res.send(services);
    });
    //services details
    app.get("/services/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await servicesCollection.findOne(query);
      res.send(result);
    });
    //top decorator
    app.get("/decorators/top", async (req, res) => {
      const { limit } = req.query;
      const query = {
        role: "decorator",
        "decoratorInfo.status": "active",
      };

      let cursor = usersCollection
        .find(query)
        .sort({ "decoratorInfo.rating": -1 });

      if (limit) {
        cursor = cursor.limit(parseInt(limit));
      }

      const topDecorators = await cursor.toArray();
      res.send(topDecorators);
    });

    //bookings get api
    app.get("/bookings/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const booking = await bookingsCollection.findOne(query);
      res.send(booking);
    });

    //booking get api by user Email

    app.get("/bookings/user/:email", async (req, res) => {
      const email = req.params.email;
      const query = { userEmail: email };
      const bookings = await bookingsCollection
        .find(query)
        .sort({ createdAt: -1 })
        .toArray();
      res.send(bookings);
    });

    //booking post api
    app.post("/bookings", async (req, res) => {
      const booking = req.body;
      booking.createdAt = new Date();
      booking.status = "pending";
      booking.paid = false;
      booking.projectStatus = "assigned";

      const result = await bookingsCollection.insertOne(booking);
      res.send(result);
    });

    //delete booking
    app.delete("/bookings/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await bookingsCollection.deleteOne(query);
      res.send(result);
    });

    //booking update

    app.patch("/bookings/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updateData = req.body;
      const updateDoc = {
        $set: {
          ...updateData,
          updatedAt: new Date(),
        },
      };
      const result = await bookingsCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

// checking email
  app.get('/users/:email/role', async (req, res) => {
  const email = req.params.email;
  const query = { email };
  const user = await usersCollection.findOne(query);
  res.send({ role: user?.role || 'user' });
});

// Get all services by admin
app.get('/services', async (req, res) => {
  const { limit, search, category, minPrice, maxPrice } = req.query;
  const query = {};
  if (search) {
    query.service_name = { $regex: search, $options: "i" };
  }
  if (category && category !== 'all') {
    query.service_category = category;
  }
  if (minPrice || maxPrice) {
    query.cost = {};
    if (minPrice) query.cost.$gte = parseFloat(minPrice);
    if (maxPrice) query.cost.$lte = parseFloat(maxPrice);
  }
  let cursor = servicesCollection.find(query).sort({ createdAt: -1 });
  if (limit) {
    cursor = cursor.limit(parseInt(limit));
  }
  const services = await cursor.toArray();
  res.send(services);
});


// Update service (Admin)
app.put('/services/:id', async (req, res) => {
  const id = req.params.id;
  const filter = { _id: new ObjectId(id) };
  const updatedService = req.body;
  delete updatedService._id; // Remove _id from update
  const updateDoc = { 
    $set: {
      ...updatedService,
      updatedAt: new Date()
    }
  };
  const result = await servicesCollection.updateOne(filter, updateDoc);
  res.send(result);
});

// Create service Admin
app.post('/services', async (req, res) => {
  const service = req.body;
  service.createdAt = new Date();
  const result = await servicesCollection.insertOne(service);
  res.send(result);
});


// Delete service by admin
app.delete('/services/:id', async (req, res) => {
  const id = req.params.id;
  const query = { _id: new ObjectId(id) };
  const result = await servicesCollection.deleteOne(query);
  res.send(result);
});

    
    // admin booking
    app.get("/admin/bookings", async (req, res) => {
      const { status, paid } = req.query;
      let query = {};

      if (status) {
        query.status = status;
      }

      if (paid !== undefined) {
        query.paid = paid === "true";
      }

      const bookings = await bookingsCollection
        .find(query)
        .sort({ createdAt: -1 })
        .toArray();
      res.send(bookings);
    });

    // Get all users Admin
    app.get("/admin/users", async (req, res) => {
      const { role, searchText } = req.query;
      let query = {};

      if (role) {
        query.role = role;
      }

      if (searchText) {
        query.$or = [
          { name: { $regex: searchText, $options: "i" } },
          { email: { $regex: searchText, $options: "i" } },
        ];
      }

      const users = await usersCollection
        .find(query)
        .sort({ createdAt: -1 })
        .toArray();
      res.send(users);
    });

    // Make user a decorator (Admin)
    app.patch("/admin/users/:email/make-decorator", async (req, res) => {
      const email = req.params.email;
      const decoratorInfo = {
        rating: 0,
        specialties: [],
        experience: "0 years",
        completedProjects: 0,
        status: "active",
        bio: "",
        availability: true,
      };

      const filter = { email: email };
      const updateDoc = {
        $set: {
          role: "decorator",
          decoratorInfo: decoratorInfo,
          updatedAt: new Date(),
        },
      };

      const result = await usersCollection.updateOne(filter, updateDoc);
      res.send(result);
    });


//make decorator to user by admin

    app.patch("/admin/users/:email/demote-decorator", async (req, res) => {
  const email = req.params.email;

  const filter = { email: email };
  const updateDoc = {
    $set: {
      role: "user",     
      decoratorInfo: null,
      updatedAt: new Date(),
    },
  };

  const result = await usersCollection.updateOne(filter, updateDoc);
  res.send(result);
});
    // Assign decorator to booking (Admin)
    app.patch("/admin/bookings/:id/assign-decorator", async (req, res) => {
      const id = req.params.id;
      const { decoratorEmail, decoratorName } = req.body;

      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          assignedDecoratorEmail: decoratorEmail,
          assignedDecoratorName: decoratorName,
          status: "confirmed",
          updatedAt: new Date(),
        },
      };

      const result = await bookingsCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

//Manage Booking section
// Get all bookings (Admin)
app.get('/admin/bookings', async (req, res) => {
  const { status, paid } = req.query;
  let query = {};

  if (status && status !== 'all') {
    query.status = status;
  }

  if (paid && paid !== 'all') {
    query.paid = paid === 'true';
  }

  const bookings = await bookingsCollection.find(query).sort({ createdAt: -1 }).toArray();
  res.send(bookings);
});

// Get active decorators for assignment (Admin)
app.get('/admin/decorators/active', async (req, res) => {
  const query = { 
    role: 'decorator', 
    'decoratorInfo.status': 'active' 
  };
  const decorators = await usersCollection.find(query).toArray();
  res.send(decorators);
});

// Assign decorator to booking (Admin) 
app.patch('/admin/bookings/:id/assign-decorator', async (req, res) => {
  const id = req.params.id;
  const { decoratorEmail, decoratorName } = req.body;
  
  // Check if booking exists and is paid
  const booking = await bookingsCollection.findOne({ _id: new ObjectId(id) });
  
  if (!booking) {
    return res.status(404).send({ message: 'Booking not found' });
  }
  
  if (!booking.paid) {
    return res.status(400).send({ message: 'Cannot assign decorator. Booking is not paid yet.' });
  }
  
  const filter = { _id: new ObjectId(id) };
  const updateDoc = {
    $set: {
      assignedDecoratorEmail: decoratorEmail,
      assignedDecoratorName: decoratorName,
      status: 'confirmed',
      updatedAt: new Date()
    }
  };
  
  const result = await bookingsCollection.updateOne(filter, updateDoc);
  res.send(result);
});



// Get decorator's assigned bookings
app.get('/decorator/bookings/:email', async (req, res) => {
  const email = req.params.email;
  const query = { assignedDecoratorEmail: email };
  const bookings = await bookingsCollection.find(query).sort({ createdAt: -1 }).toArray();
  res.send(bookings);
});

// Update project status (Decorator)
app.patch('/decorator/bookings/:id/status', async (req, res) => {
  const id = req.params.id;
  const { projectStatus } = req.body;
  
  const filter = { _id: new ObjectId(id) };
  const updateDoc = {
    $set: {
      projectStatus: projectStatus,
      updatedAt: new Date()
    }
  };
  
  const result = await bookingsCollection.updateOne(filter, updateDoc);
  res.send(result);
});

// Get decorator earnings (Decorator)
app.get('/decorator/earnings/:email', async (req, res) => {
  const email = req.params.email;
  const completedBookings = await bookingsCollection.find({
    assignedDecoratorEmail: email,
    projectStatus: 'completed',
    paid: true
  }).toArray();
  
  const totalEarnings = completedBookings.reduce((sum, booking) => {
    return sum + (booking.totalCost || 0);
  }, 0);
  
  const totalProjects = completedBookings.length;
  
  res.send({
    totalEarnings,
    totalProjects,
    completedBookings
  });
});
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
