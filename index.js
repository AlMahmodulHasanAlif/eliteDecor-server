const express = require('express');
const cors = require('cors');
const app = express();
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const port = process.env.PORT || 3000;
const admin = require("firebase-admin");

 
// FIREBASE ADMIN INITIALIZATION

const serviceAccount = require('./fbtoken.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});



// MIDDLEWARE

app.use(express.json());
app.use(cors());

// Verify Firebase Token
const verifyFBToken = async (req, res, next) => {
    const token = req.headers.authorization;
    if (!token) {
        return res.status(401).send({ message: 'unauthorized access' });
    }
    try {
        const idToken = token.split(' ')[1];
        const decoded = await admin.auth().verifyIdToken(idToken);
        req.decoded_email = decoded.email;
        next();
    } catch (err) {
        return res.status(401).send({ message: 'unauthorized access' });
    }
};


// STRIPE CHECKOUT (Before MongoDB connection)
// 
app.post('/create-checkout-session', async (req, res) => {
  const { booking } = req.body;

  if (!booking) return res.status(400).send({ error: 'Booking required' });

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'bdt',
            product_data: {
              name: booking.serviceName,
              description: `Booking for ${new Date(booking.bookingDate).toLocaleDateString()} at ${booking.location}`,
            },
            unit_amount: booking.totalCost * 100,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${process.env.CLIENT_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}&booking_id=${booking._id}`,
      cancel_url: `${process.env.CLIENT_URL}/payment/cancel?booking_id=${booking._id}`,
      metadata: {
        bookingId: booking._id,
        userEmail: booking.userEmail,
      },
    });

    res.send({ url: session.url });
  } catch (error) {
    console.error('Stripe create session error:', error);
    res.status(500).send({ error: error.message });
  }
});


// MONGODB CONNECTION

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
    const paymentsCollection = database.collection("payments");

    
    // ROLE VERIFICATION MIDDLEWARE (Inside run() to access collections)
    
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded_email;
      const user = await usersCollection.findOne({ email });
      if (user?.role !== 'admin') {
        return res.status(403).send({ message: 'Forbidden: Admin access required' });
      }
      next();
    };

    const verifyDecorator = async (req, res, next) => {
      const email = req.decoded_email;
      const user = await usersCollection.findOne({ email });
      if (user?.role !== 'decorator') {
        return res.status(403).send({ message: 'Forbidden: Decorator access required' });
      }
      next();
    };

    
    // PAYMENT ROUTES
    
    app.post('/verify-payment', async (req, res) => {
      const { sessionId, bookingId } = req.body;

      if (!sessionId || !bookingId) {
        return res.status(400).send({ error: 'Session ID and Booking ID required' });
      }

      try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);

        if (session.payment_status !== 'paid') {
          return res.status(400).send({ error: 'Payment not completed' });
        }

        const payment = {
          bookingId,
          transactionId: session.payment_intent,
          amount: session.amount_total / 100,
          currency: session.currency.toUpperCase(),
          userEmail: session.metadata.userEmail,
          status: 'completed',
          createdAt: new Date(),
        };

        const result = await paymentsCollection.insertOne(payment);

        await bookingsCollection.updateOne(
          { _id: new ObjectId(bookingId) },
          {
            $set: {
              paid: true,
              paymentId: result.insertedId,
              transactionId: session.payment_intent,
              updatedAt: new Date(),
            },
          }
        );

        res.send({ success: true, payment });
      } catch (error) {
        console.error('Verify payment error:', error);
        res.status(500).send({ error: error.message });
      }
    });

    app.get('/payments/user/:email', verifyFBToken, async (req, res) => {
      const email = req.params.email;
      
      if (email !== req.decoded_email) {
        return res.status(403).send({ message: 'Forbidden access' });
      }
      
      const query = { userEmail: email };
      const payments = await paymentsCollection
        .find(query)
        .sort({ createdAt: -1 })
        .toArray();
      res.send(payments);
    });

    
    // USER ROUTES
    
    app.get("/users/:email", async (req, res) => {
      const email = req.params.email;
      const user = await usersCollection.findOne({ email });
      res.send(user);
    });

    app.get('/users/:email/role', async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      res.send({ role: user?.role || 'user' });
    });

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

    
    // SERVICES ROUTES
    
    app.get("/services", async (req, res) => {
      const { limit, search, category, sort, minPrice, maxPrice } = req.query;
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

    app.get("/services/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await servicesCollection.findOne(query);
      res.send(result);
    });

    // PROTECTED: Admin only routes for services
    app.post('/services', verifyFBToken, verifyAdmin, async (req, res) => {
      const service = req.body;
      service.createdAt = new Date();
      const result = await servicesCollection.insertOne(service);
      res.send(result);
    });

    app.put('/services/:id', verifyFBToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updatedService = req.body;
      delete updatedService._id;
      const updateDoc = { 
        $set: {
          ...updatedService,
          updatedAt: new Date()
        }
      };
      const result = await servicesCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    app.delete('/services/:id', verifyFBToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await servicesCollection.deleteOne(query);
      res.send(result);
    });

    
    // DECORATORS ROUTES
    
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

    
    // BOOKINGS ROUTES (USER)
    
    app.get("/bookings/:id", verifyFBToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const booking = await bookingsCollection.findOne(query);
      res.send(booking);
    });

    app.get("/bookings/user/:email", verifyFBToken, async (req, res) => {
      const email = req.params.email;
      
      if (email !== req.decoded_email) {
        return res.status(403).send({ message: 'Forbidden access' });
      }
      
      const query = { userEmail: email };
      const bookings = await bookingsCollection
        .find(query)
        .sort({ createdAt: -1 })
        .toArray();
      res.send(bookings);
    });

    app.post("/bookings", verifyFBToken, async (req, res) => {
      const booking = req.body;
      booking.createdAt = new Date();
      booking.status = "pending";
      booking.paid = false;
      booking.projectStatus = "assigned";

      const result = await bookingsCollection.insertOne(booking);
      res.send(result);
    });

    app.delete("/bookings/:id", verifyFBToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await bookingsCollection.deleteOne(query);
      res.send(result);
    });

    app.patch("/bookings/:id", verifyFBToken, async (req, res) => {
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

    
    // ADMIN ROUTES (Protected)
    
    app.get("/admin/bookings", verifyFBToken, verifyAdmin, async (req, res) => {
      const { status, paid } = req.query;
      let query = {};

      if (status && status !== 'all') {
        query.status = status;
      }

      if (paid && paid !== 'all') {
        query.paid = paid === "true";
      }

      const bookings = await bookingsCollection
        .find(query)
        .sort({ createdAt: -1 })
        .toArray();
      res.send(bookings);
    });

    app.get("/admin/users", verifyFBToken, verifyAdmin, async (req, res) => {
      const { role, searchText } = req.query;
      let query = {};

      if (role && role !== 'all') {
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

    app.patch("/admin/users/:email/make-decorator", verifyFBToken, verifyAdmin, async (req, res) => {
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

    app.patch("/admin/users/:email/demote-decorator", verifyFBToken, verifyAdmin, async (req, res) => {
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

    app.get('/admin/decorators/active', verifyFBToken, verifyAdmin, async (req, res) => {
      const query = {
        role: 'decorator',
        'decoratorInfo.status': 'active'
      };
      const decorators = await usersCollection.find(query).toArray();
      res.send(decorators);
    });

    app.patch('/admin/bookings/:id/assign-decorator', verifyFBToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const { decoratorEmail, decoratorName } = req.body;

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

    
    // DECORATOR ROUTES (Protected)
    
    app.get('/decorator/bookings/:email', verifyFBToken, verifyDecorator, async (req, res) => {
      const email = req.params.email;
      
      if (email !== req.decoded_email) {
        return res.status(403).send({ message: 'Forbidden access' });
      }
      
      const query = { assignedDecoratorEmail: email };
      const bookings = await bookingsCollection.find(query).sort({ createdAt: -1 }).toArray();
      res.send(bookings);
    });

    app.patch('/decorator/bookings/:id/status', verifyFBToken, verifyDecorator, async (req, res) => {
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

    app.get('/decorator/earnings/:email', verifyFBToken, verifyDecorator, async (req, res) => {
      const email = req.params.email;
      
      if (email !== req.decoded_email) {
        return res.status(403).send({ message: 'Forbidden access' });
      }
      
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

    
    await client.connect();
    await client.db("admin").command({ ping: 1 });
    console.log("✅ Connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("EliteDecor API with Firebase Auth is running! 🎨🔥");
});

app.listen(port, () => {
  console.log(`✅ Server running on port ${port}`);
});